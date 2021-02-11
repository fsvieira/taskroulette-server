const path = require("path");
const mkdirp = require("mkdirp");
const sqlite3 = require("sqlite3");
const {
    tasksToJSONAPI
} = require("./jsonapi");

const dbs = {};

const CREATE = 1,
    UPDATE = 2,
    DELETE = 3;

class DBConnection {
    constructor(userID) {
        this.subscribers = [];
        this.userID = userID;
        this.dir = path.join(process.cwd(), "dbs", "u" + userID);
        this.file = path.join(this.dir, "db.sqlite");
        this._conn = null;
        this.closeTimeoutID = 0;
        this.triggerTimeoutID = 0;
        this.syncRevision = null;
        //        this.nextSyncRevision();
        this.wait = [];
    }

    async getSyncRevision() {
        if (this.syncRevision === null) {
            const data = await this.all(
                `SELECT max(syncRevision) AS syncRevision FROM (
                    SELECT max(
                        description_rev, done_rev, deleted_rev,
                        done_until_rev, created_at_rev, updated_at_rev
                    ) AS syncRevision FROM task
                    UNION
                    SELECT max(
                        created_at_rev, due_date_rev, updated_at_rev
                    ) AS syncRevision FROM sprint
                    UNION
                    SELECT max(
                        task_id_rev, position_rev,
                        created_at_rev, update_at_rev
                    ) AS syncRevision FROM todo
                )`);

            console.log("DB SYNC", JSON.stringify(data));
            if (data) {
                this.syncRevision = data[0].syncRevision || 0;
            }
            else {
                this.syncRevision = 0;
            }

        }

        return this.syncRevision;
    }

    async nextSyncRevision() {
        await this.getSyncRevision();
        return ++this.syncRevision;
    }

    async run(stmt, params, success) {
        const conn = await this.conn();

        return new Promise((resolve, reject) => {
            conn.run(stmt, params, err =>
                err ? reject(err) : resolve(success)
            );
        })
    }

    async all(stmt, params) {
        const conn = await this.conn();

        return new Promise((resolve, reject) => {
            conn.all(stmt, params, (err, rows) =>
                err ? reject(err) : resolve(rows)
            );
        })
    }

    async conn() {
        if (this._conn) {
            return this._conn;
        }

        return new Promise((resolve, reject) => {
            this.wait.push({ resolve, reject });
            this.openConn();
        });
    }

    async openConn() {
        if (!this.lock && !this._conn) {
            this.lock = true;

            try {
                if (!this._conn) {
                    await mkdirp(this.dir);

                    console.log("OPEN " + this.file);
                    let db = new sqlite3.Database(this.file,
                        sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                        err => {
                            if (err) {
                                this.wait.forEach(({ reject }) => reject(err));
                                this.lock = false;
                            }
                        }
                    );

                    db.serialize(() => {
                        // -- Tasks
                        db.run(`CREATE TABLE IF NOT EXISTS task (
                            task_id TEXT PRIMARY KEY,
                            description TEXT,
                            done INTEGER(1) DEFAULT 0,
                            deleted INTEGER(1) DEFAULT 0,
                            done_until INTEGER(4),
                            created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                            updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')),
                            description_rev INTEGER(8) DEFAULT 0,
                            done_rev INTEGER(8) DEFAULT 0,
                            deleted_rev INTEGER(8) DEFAULT 0,
                            done_until_rev INTEGER(8) DEFAULT 0,
                            created_at_rev INTEGER(8) DEFAULT 0,
                            updated_at_rev INTEGER(8) DEFAULT 0,
                            source TEXT
                        )`);

                        // -- Tags
                        /*
                        db.run(`CREATE TABLE IF NOT EXISTS tag (
                            tag_id TEXT PRIMARY KEY
                        )`);*/

                        // -- Relation tasks <-> tags
                        db.run(`CREATE TABLE IF NOT EXISTS task_tags (
                            task_id TEXT,
                            tag TEXT,
                            active INTEGER(0),
                            rev INTEGER(8) DEFAULT 0,
                            FOREIGN KEY(task_id) REFERENCES task(task_id)
                            PRIMARY KEY(task_id, tag)
                        )`);

                        // -- Sprints
                        db.run(`CREATE TABLE IF NOT EXISTS sprint (
                            sprint_id TEXT PRIMARY KEY,
                            created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                            updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                            due_date INTEGER(4),
                            created_at_rev INTEGER(8) DEFAULT 0,
                            due_date_rev INTEGER(8) DEFAULT 0,
                            updated_at_rev INTEGER(8) DEFAULT 0,
                            source TEXT
                        )`);

                        // -- Relation Sprint <-> tags
                        db.run(`CREATE TABLE IF NOT EXISTS sprint_tags (
                            sprint_id TEXT,
                            tag TEXT,
                            active INTEGER(1),
                            rev INTEGER(8) DEFAULT 0,
                            FOREIGN KEY(sprint_id) REFERENCES sprint(sprint_id)
                            PRIMARY KEY(sprint_id, tag)
                        )`);

                        // -- Todo
                        // should position be primary key ? 
                        db.run(`CREATE TABLE IF NOT EXISTS todo (
                            todo_id TEXT PRIMARY KEY,
                            task_id TEXT,
                            position INTEGER(4) NOT NULL DEFAULT 1,
                            created_at,
                            updated_at,
                            task_id_rev INTEGER(8) DEFAULT 0,
                            position_rev INTEGER(8) DEFAULT 0,
                            created_at_rev INTEGER(8) DEFAULT 0,
                            update_at_rev INTEGER(8) DEFAULT 0,
                            FOREIGN KEY("task_id") REFERENCES task(task_id)
                        )`);
                    });

                    this._conn = db;
                }

                this.wait.forEach(({ resolve }) => resolve(this._conn));
            }
            catch (e) {
                reject(e);
            }
        }
    }

    trigger() {
        console.log("Trigger");
        if (!this.triggerTimeoutID) {
            // delay trigger to 5s, this will make 
            this.triggerTimeoutID = setTimeout(() => {
                this.triggerTimeoutID = 0;
                this.subscribers.forEach(o => o.trigger());
            }, 5000);
        }
    }

    subscribe(o) {
        clearTimeout(this.closeTimeoutID);
        this.subscribers.push(o);
    }

    unsubscribe(o) {
        this.subscribers.splice(this.subscribers.indexOf(o), 1);

        // wait 5s for new subscribers before close database,
        if (this.subscribers.length === 0) {
            this.closeTimeoutID = setTimeout(() => this.close(), 5000);
        }
    }

    close() {
        delete dbs[this.userID];
        this._conn.close();
    }
}

class DB {
    constructor(userID) {
        this.userID = userID;
        // TODO: add also username ? 
        this.subscribers = [];
        this.delayedHandle;

        this.db = dbs[userID];

        if (!this.db) {
            this.db = dbs[userID] = new DBConnection(userID);
        }

        this.db.subscribe(this);
    }

    close() {
        this.db.unsubscribe(this);
    }

    async getSyncRevision() {
        return this.db.getSyncRevision();
    }
    /*
        Get changes
    */
    async getTaskTags(taskID, syncRevision) {
        const tags = await this.db.all(`
            SELECT * FROM task_tags where task_id=? AND rev>?;
        `, [taskID, syncRevision]);

        return tags;
    }

    async getTasksChanges(syncRevision, clientIdentity) {
        console.log("SyncRev ", syncRevision);
        const dbChanges = await this.db.all(`
            SELECT 
                task_id AS key, 
                task_id AS taskID,
                description,
                done,
                deleted,
                done_until AS doneUntil,
                created_at AS createdAt,
                updated_at As updatedAt,
                description_rev AS descriptionRev,
                done_rev AS doneRev,
                deleted_rev AS deletedRev,
                done_until_rev AS doneUntilRev,
                created_at_rev AS createdAtRev,
                updated_at_rev AS updatedAtRev
            FROM task 
            WHERE 
                updated_at_rev>$syncRevision AND source!=$source;
            `, {
                $syncRevision: syncRevision,
                $source: clientIdentity
            }
        );

        const fields = [
            'description', 'done', 'deleted', 'doneUntil', 'updatedAt'
        ];

        const changes = [];

        for (let i = 0; i < dbChanges.length; i++) {
            const {
                table,
                key,
                descriptionRev,
                doneRev,
                deletedRev,
                doneUntilRev,
                createdAtRev,
                updatedAtRev,
                ...obj
            } = dbChanges[i];

            const tags = await this.getTaskTags(key);

            console.log(JSON.stringify(tags));
            console.log("TEST UPDATE", syncRevision, createRev, rev);

            if (syncRevision < createRev) {
                // TODO: get tags
                obj.tags = tags.reduce((acc, { tag }) => {
                    acc[tag] = true;
                    return acc;
                }, {});

                changes.push({
                    rev: updatedAtRev,
                    type: CREATE,
                    table: 'tasks',
                    key,
                    obj
                });
            }
            else {
                const { description, done, deleted, doneUntil, updatedAt } = obj;

                changes.push({
                    rev,
                    type: UPDATE,
                    table,
                    key,
                    mods: {
                        description,
                        done,
                        deleted,
                        doneUntil,
                        updatedAt,
                        ...(
                            tags.reduce((acc, { tag }) => {
                                acc[`tags.${tag}`] = true;
                                return acc;
                            }, {})
                        )
                    }
                });
            }
        }

        console.log(JSON.stringify(changes));
        return changes;
    }

    async getChanges(syncRevision, clientIdentity) {
        return this.getTasksChanges(syncRevision, clientIdentity);
    }

    /*
        Create, Update, Delete
    */

    /* Tasks 
        TODO:
            - save device id (clientIdentity) on table,
            - tags should have (taskID, tag, keep=[true, null])
                * this is needed when sending changes to clients,
            - on task add 2 revisions (syncRevision):
                - create revision,
                - update revision.
     
            if (syncRevision <  create_revision ) {
                send create task, 
                send {
                    rev: 2,
                    source: '6c29e53c-50c6-41ec-871a-3edd3a4cdb24',
                        type: 1,
                        table: 'tasks',
                        key: '9da1e79f-f4ff-42ea-b181-640b441f49b2',
                        obj: {
                        taskID: '9da1e79f-f4ff-42ea-b181-640b441f49b2',
                        description: 'Chrome 4 - Brave 4 #yeah',
                        tags: [Object], // tags is an object {sometag: true, sometag2: true}
                        done: 0,
                        deleted: 0,
                        createdAt: '2021-02-06T23:56:28.018Z',
                        updatedAt: '2021-02-07T00:00:34.056Z'
                    }
                }
            }
            else if (syncRevision < update revision) {
                // send update task, 
                send {
                    description: 'Chrome 4 - Brave 4 #yeah',
                    'tags.tag1': null,
                    'tags.tag4': null,
                    'tags.tag5': null,
                    'tags.tag2': null,
                    'tags.tag6': null,
                    'tags.yeah': true,
                    updatedAt: '2021-02-07T00:00:34.056Z'
                }
    
                // all deleted tags from creation should be saved and sent as null. 
            }
            else {
                nothing to do. 
            }
    */

    async addTaskTags(taskID, tags, syncRevision) {
        const tagsArray = Object.keys(tags);
        console.log(JSON.stringify(tags));

        /*
        await this.db.run(`DELETE FROM task_tags WHERE task_id=? AND tag not in (?);`,
            [taskID, tagsArray]
        );*/

        await this.db.run(`INSERT INTO task_tags (task_id, tag, active, rev) VALUES ${tagsArray.map(() => "(?, ?, ?, ?)")};`,
            tagsArray.map(tag => [taskID, tag, tags[tag] ? 1 : 0, syncRevision]).reduce((acc, v) => acc.concat(v), [])
        );
    }

    async createTask(
        taskID,
        {
            description,
            done,
            deleted,
            doneUntil = null,
            createdAt,
            updatedAt,
            tags
        },
        clientIdentity
    ) {
        console.log("ADD task!");
        const syncRevision = await this.db.nextSyncRevision();

        console.log("Sync Rev ", this.db.syncRevision, syncRevision);

        await this.db.run(
            `INSERT OR IGNORE INTO TASK (
                task_id,
                description,
                done,
                deleted,
                done_until,
                created_at,
                updated_at,
                source,
                description_rev,
                done_rev,
                deleted_rev,
                done_until_rev,
                created_at_rev,
                updated_at_rev
            ) VALUES (
                $taskID, $description, $done, $deleted, $doneUntil, $createdAt, $updatedAt, $source,
                $syncRevision,
                $syncRevision,
                $syncRevision,
                $syncRevision,
                $syncRevision,
                $syncRevision
            )`, {
                $taskID: taskID,
                $description: description,
                $done: done,
                $deleted: deleted,
                $doneUntil: doneUntil,
                $createdAt: createdAt,
                $updatedAt: updatedAt,
                $source: clientIdentity,
                $syncRevision: syncRevision
            }
        );

        return this.addTaskTags(taskID, tags);
    }

    async create(table, key, obj, clientIdentity) {
        switch (table) {
            case "tasks": {
                await this.createTask(key, obj, clientIdentity);
                break;
            }
        }

        this.db.trigger();
    }

    async updateTask(key, modifications, clientIdentity) {
        console.log(modifications);
        const taskFields = {
            "description": "description",
            "done": "done",
            "deleted": "deleted",
            "doneUntil": "done_until",
            "updateAt": "update_at"
        }

        const syncRevision = await this.db.nextSyncRevision();
        const allFields = Object.keys(modifications);
        const fields = allFields.filter(field => taskFields[field]);

        const sql = `UPDATE TASK SET 
            ${fields.map(field => `${taskFields[field]}=?`).join(",")},
            update_rev=?,
            source=?
         WHERE task_id=?`;

        console.log(sql, modifications);

        const allTags = allFields.filter(tags => tags.startsWith("tags."));
        const deletedTags = allTags.filter(tag => !modifications[tag]).map(tag => tag.replace("tags.", ""));
        const newTags = allTags.filter(tag => modifications[tag]).map(tag => tag.replace("tags.", ""));

        console.log("DELETED TAGS: ", deletedTags.join(","), " ;; NEW TAGS: ", newTags.join(", "))

        return this.db.run(
            sql,
            fields.map(field => modifications[field]).concat([syncRevision, clientIdentity, key])
        ).then(() => {
            /*if (modifications.tags) {
                return this.addTaskTags(taskID, modifications.tags);
            }*/
        });
    }

    async update(table, key, obj, clientIdentity) {
        console.log("DB UPDATE", JSON.stringify({
            table, key, obj, clientIdentity
        }));

        try {
            switch (table) {
                case "tasks": {
                    await this.updateTask(key, obj, clientIdentity)
                    break;
                }
            }

            this.db.trigger();
        } catch (e) {
            console.log(e);
        }
    }

    async delete(table, key, clientIdentity) {
        console.log("DB DELETE", JSON.stringify({
            table, key, clientIdentity
        }));

        this.db.trigger();
    }

    async trigger() {
        if (!this.delayedHandle) {
            // Delay the trigger so that it's only called once per bunch of changes instead of being called for each single change.
            this.delayedHandle = setTimeout(() => {
                delete this.delayedHandle;
                this.subscribers.forEach(subscriber => {
                    try { subscriber(); } catch (e) {
                        console.log(e);
                    }
                });


            }, 0);
        }
    }

    async subscribe(fn) {
        this.subscribers.push(fn);
    }
    async unsubscribe(fn) {
        this.subscribers.splice(this.subscribers.indexOf(fn), 1);
    }

    /**
     * Tags
     */
    async addTags(tags) {
        /*
        const conn = await this.db.conn();
    
        return new Promise((resolve, reject) => {
            conn.run(
                `INSERT OR IGNORE INTO tag(id) values ${ tags.map(() => "(?)").join(" ") }; `,
                tags.map(({ id }) => id),
                err => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(tags);
                    }
                }
            );
        });*/
        return this.db.run(
            `INSERT OR IGNORE INTO tag(id) values ${tags.map(() => "(?)").join(" ")}; `,
            tags.map(({ id }) => id),
            tags
        );
    }

    /**
     * Todo
     */
    async updateTodo(todo) {
        /*
        const conn = await this.db.conn();
    
        return new Promise((resolve, reject) => {
            conn.run(
                `INSERT OR IGNORE INTO
        todo(id, task_id) values(?, ?)
        ON CONFLICT(id) DO UPDATE SET
        task_id =?
                ; `,
                [id, taskID, taskID],
                err => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(todo);
                    }
                }
            );
        });*/
        console.log("TODO", JSON.stringify(todo));
        const { data: { id, relationships } } = todo;

        if (relationships) {
            const { task: { id: taskID } } = relationships;

            return this.db.run(
                `INSERT OR IGNORE INTO
                    todo(id, task_id) values (?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                    task_id=?
                ; `,
                [id, taskID, taskID],
                todo
            );
        }

        return todo;
    }

    /**
     * Task
     */
    getTasks(filter, taskID) {
        let where = [];
        let params = [];
        const bool = ["false", "true"]
        if (filter) {
            const { deleted, done } = filter;
            const deletedBool = bool.indexOf(deleted);
            const doneBool = bool.indexOf(done);

            if (deletedBool !== -1) {
                where.push("deleted=?");
                params.push(deletedBool);
            }

            if (doneBool !== -1) {
                where.push("done=?");
                params.push(doneBool);
            }
        }

        if (taskID) {
            where.push("id=?");
            params.push(taskID);
        }

        const sql = `SELECT * FROM task ${where.length ? `WHERE ${where.join(" AND ")}` : ""}; `;

        return this.all(sql, params);
    }

    async getTasksJSONAPI(filter, taskID) {
        return tasksToJSONAPI(await getTasks(filter, taskID));
    }

}

module.exports = DB;

