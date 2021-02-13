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
                            done_until TEXT,
                            created_at TEXT, 
                            updated_at TEXT,
                            description_rev INTEGER(8) DEFAULT 0,
                            done_rev INTEGER(8) DEFAULT 0,
                            deleted_rev INTEGER(8) DEFAULT 0,
                            done_until_rev INTEGER(8) DEFAULT 0,
                            created_at_rev INTEGER(8) DEFAULT 0,
                            updated_at_rev INTEGER(8) DEFAULT 0
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
                            updated_at_rev INTEGER(8) DEFAULT 0
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


    /* ----------
       TASKS
    ------------ */

    /*
        Get
    */
    async getTaskTags(taskID, syncRevision) {
        const tags = await this.db.all(`
            SELECT * FROM task_tags where task_id=$taskID AND rev>$syncRevision;
        `, {
                $taskID: taskID,
                $syncRevision: syncRevision
            });

        return tags;
    }

    async getTask(taskID) {
        const data = await this.db.all(`
            SELECT
                task_id AS taskID,
                description,
                done,
                deleted,
                done_until AS doneUntil,
                created_at AS createdAt, 
                updated_at AS updatedAt,
                description_rev AS descriptionRev,
                done_rev AS doneRev,
                deleted_rev AS deletedRev,
                done_until_rev AS doneUntilRev,
                created_at_rev AS createdAtRev,
                updated_at_rev AS updatedAtRev
            FROM task WHERE task_id=$taskID
        `, { $taskID: taskID });

        const task = data[0];

        if (task) {
            task.tags = await this.getTaskTags(taskID, 0);
        }

        return task;
    }

    async getTasksChanges(syncRevision) {
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
                updated_at_rev>$syncRevision;
            `, {
                $syncRevision: syncRevision
            }
        );

        const changes = [];
        const table = 'tasks';

        for (let i = 0; i < dbChanges.length; i++) {
            const {
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
            console.log("TEST UPDATE", syncRevision, createdAtRev, updatedAtRev);

            if (syncRevision < createdAtRev) {
                // TODO: get tags
                obj.tags = tags.reduce((acc, { tag }) => {
                    acc[tag] = true;
                    return acc;
                }, {});

                changes.push({
                    rev: updatedAtRev,
                    type: CREATE,
                    table,
                    key,
                    obj
                });
            }
            else {
                const revs = {
                    descriptionRev,
                    doneRev,
                    deletedRev,
                    doneUntilRev,
                    createdAtRev,
                    updatedAtRev
                };

                const mods = {};

                for (let field in obj) {
                    const fieldRev = `${field}Rev`;

                    if (revs[fieldRev] && revs[fieldRev] > syncRevision) {
                        mods[field] = obj[field];
                    }
                }

                changes.push({
                    rev: updatedAtRev,
                    type: UPDATE,
                    table,
                    key,
                    mods
                });
            }
        }

        console.log(JSON.stringify(changes));
        return changes;
    }

    async getChanges(syncRevision) {
        return this.getTasksChanges(syncRevision);
    }

    /*
        Create, Update, Delete
    */

    async addTaskTags(taskID, tags, syncRevision) {
        const tagsArray = Object.keys(tags);
        console.log("TAGS", JSON.stringify(tags), JSON.stringify(tagsArray));

        const tagsArgs = {};
        for (let tag in tags) {
            tagsArgs['$' + tag] = tag;
        }

        const sql = `INSERT INTO task_tags (task_id, tag, active, rev) 
            VALUES ${tagsArray.map(tag => `($taskID, $${tag}, ${tags[tag] ? 1 : 0}, $rev)`).join(",")}
            ON CONFLICT(task_id, tag) DO UPDATE SET
                active=excluded.active,
                rev=excluded.rev
        `;

        console.log(sql, JSON.stringify({
            $taskID: taskID,
            ...tagsArgs,
            $rev: syncRevision
        }));
        await this.db.run(sql, {
            $taskID: taskID,
            ...tagsArgs,
            $rev: syncRevision
        });

        /*
        await this.db.run(`DELETE FROM task_tags WHERE task_id=? AND tag not in (?);`,
            [taskID, tagsArray]
        );*/

        /*await this.db.run(`INSERT INTO task_tags (task_id, tag, active, rev) VALUES ${tagsArray.map(() => "(?, ?, ?, ?)")};`,
            tagsArray.map(tag => [taskID, tag, tags[tag] ? 1 : 0, syncRevision]).reduce((acc, v) => acc.concat(v), [])
        );*/
    }

    async addTask(task) {

        const argsTask = {};
        for (let field in task) {
            argsTask['$' + field] = task[field]
        }

        delete argsTask.$tags;

        console.log("--------->", JSON.stringify(argsTask));

        await this.db.run(
            `INSERT INTO TASK (
                    task_id,
                    description,
                    done,
                    deleted,
                    done_until,
                    created_at,
                    updated_at,
                    description_rev,
                    done_rev,
                    deleted_rev,
                    done_until_rev,
                    created_at_rev,
                    updated_at_rev
                ) VALUES (
                    $taskID, 
                    $description, 
                    $done, 
                    $deleted, 
                    $doneUntil, 
                    $createdAt, 
                    $updatedAt, 
                    $descriptionRev, 
                    $doneRev, 
                    $deletedRev, 
                    $doneUntilRev, 
                    $createdAtRev, 
                    $updatedAtRev
                )
                ON CONFLICT(task_id) DO UPDATE SET
                    description=$description, 
                    done=$done, 
                    deleted=$deleted, 
                    done_until=$doneUntil, 
                    created_at=$createdAt, 
                    updated_at=$updatedAt, 
                    description_rev=$descriptionRev, 
                    done_rev=$doneRev, 
                    deleted_rev=$deletedRev, 
                    done_until_rev=$doneUntilRev, 
                    created_at_rev=$createdAtRev,
                    updated_at_rev=$updatedAtRev
                `,
            argsTask
        );

        return this.addTaskTags(task.taskID, task.tags, task.updatedAtRev);

    }

    async create(table, key, obj) {
        switch (table) {
            case "tasks": {
                const syncRevision = await this.db.nextSyncRevision();
                obj.descriptionRev = syncRevision;
                obj.doneRev = syncRevision;
                obj.deletedRev = syncRevision;
                obj.doneUntilRev = syncRevision;
                obj.createdAtRev = syncRevision;
                obj.updatedAtRev = syncRevision;

                await this.addTask(obj);
                break;
            }
        }

        this.db.trigger();
    }

    async updateTask(taskID, modifications, baseRevision) {
        const task = await this.getTask(taskID);

        let update = false;
        for (let field in modifications) {
            const fieldRev = `${field}Rev`;
            if (task[fieldRev] && task[fieldRev] <= baseRevision) {
                task[field] = modifications[field];
                update = true;
            }
        }

        if (update) {
            const syncRevision = await this.db.nextSyncRevision();
            for (let field in modifications) {
                const fieldRev = `${field}Rev`;
                if (task[fieldRev] <= baseRevision) {
                    task[fieldRev] = syncRevision;
                }
            }

            const tags = Object.keys(modifications).reduce((acc, field) => {
                if (field.startsWith("tags.")) {
                    const tag = field.replace("tags.", "");
                    acc[tag] = modifications[field] ? 1 : 0;
                }

                return acc;
            }, {});

            task.tags = tags;

            await this.addTask(task);
        }
    }

    async update(table, key, obj, syncRevision) {
        console.log("DB UPDATE", JSON.stringify({
            table, key, obj
        }));

        try {
            switch (table) {
                case "tasks": {
                    await this.updateTask(key, obj, syncRevision)
                    break;
                }
            }

            this.db.trigger();
        } catch (e) {
            console.log(e);
        }
    }

    async delete(table, key) {
        console.log("DB DELETE", JSON.stringify({
            table, key
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

