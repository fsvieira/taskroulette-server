const path = require("path");
const mkdirp = require("mkdirp");
const sqlite3 = require("sqlite3");
const {
    tasksToJSONAPI
} = require("./jsonapi");

const dbs = {};

class DBConnection {
    constructor(userID) {
        this.subscribers = [];
        this.userID = userID;
        this.dir = path.join(process.cwd(), "dbs", "u" + userID);
        this.file = path.join(this.dir, "db.sqlite");
        this._conn = null;
        this.closeTimeoutID = 0;
        this.tiggerTimeoutID = 0;
    }

    async conn() {
        return new Promise(async (resolve, reject) => {
            if (!this._conn) {
                await mkdirp(this.dir);

                let db = new sqlite3.Database(this.file,
                    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                    err => {
                        if (err) {
                            reject(err);
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
                        server_updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now'))
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
                        FOREIGN KEY(task_id) REFERENCES task(id)
                        PRIMARY KEY(task_id, tag)
                    )`);

                    // -- Sprints
                    db.run(`CREATE TABLE IF NOT EXISTS sprint (
                        task_id TEXT PRIMARY KEY,
                        created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                        due_date INTEGER(4),
                        server_updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now'))
                    )`);

                    // -- Relation Sprint <-> tags
                    db.run(`CREATE TABLE IF NOT EXISTS sprint_tags (
                        sprint_id TEXT,
                        tag TEXT,
                        FOREIGN KEY(sprint_id) REFERENCES sprint(id)
                        PRIMARY KEY(sprint_id, tag)
                    )`);

                    // -- Todo
                    db.run(`CREATE TABLE IF NOT EXISTS todo (
                        todo_id TEXT PRIMARY KEY,
                        task_id TEXT,
                        server_updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')),
                        FOREIGN KEY("task_id") REFERENCES task(id)
                    )`);
                });

                this._conn = db;
            }

            resolve(this._conn);
        });
    }

    trigger() {
        if (!this.tiggerTimeoutID) {
            // delay trigger to 5s, this will make 
            this.triggerTimeoutID = setTimeout(() => {
                this.triggerTimeoutID;
                this.subscribers.map(o => o.trigger());
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

    async run(stmt, params, success) {
        const conn = await this.db.conn();

        return new Promise((resolve, reject) => {
            conn.run(stmt, params, err =>
                err ? reject(err) : resolve(success)
            );
        })
    }

    async all(stmt, params) {
        const conn = await this.db.conn();

        return new Promise((resolve, reject) => {
            conn.all(stmt, params, (err, rows) =>
                err ? reject(err) : resolve(rows)
            );
        })
    }

    /*
        Create, Update, Delete
    */
    async createTask(id, { description, done, deleted, doneUntil = null, createdAt, updatedAt, tags }) {
        console.log("TAGS", tags);

        const tagsArray = tags.keys().filter(v => tags[v]);

        await this.run(
            `INSERT INTO TASK (
                task_id,
                description,
                done,
                deleted,
                done_until,
                created_at,
                updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?
            ) ON CONFLICT(task_id) DO UPDATE SET
                description=?,
                done=?,
                deleted=?,
                done_until=?,
                updated_at=?
            `, [
                id, description, done, deleted, doneUntil, createdAt, updatedAt,
                description, done, deleted, doneUntil, updatedAt
            ]
        );

        await this.run(`DELETE FROM task_tags WHERE task_id=? AND tag not in (?);`,
            [id, tagsArray]
        );

        await this.run(`INSERT IGNORE task_tags (task_id, tag) VALUES ${tags.map("(?, ?)")};`,
            tags.map(tag => [id, tag]).reduce((acc, v) => acc.concat(v), [])
        );

    }

    async create(table, key, obj, clientIdentity) {
        console.log("DB CREATE", JSON.stringify({
            table, key, obj, clientIdentity
        }));

        switch (table) {
            case "tasks": {
                this.createTask(key, obj)
            }
        }

        this.trigger();
    }

    async update(table, key, modifications, clientIdentity) {
        console.log("DB UPDATE", JSON.stringify({
            table, key, modifications, clientIdentity
        }));

        this.trigger();
    }

    async delete(table, key, clientIdentity) {
        console.log("DB DELETE", JSON.stringify({
            table, key, clientIdentity
        }));

        this.trigger();
    }

    async trigger() {
        if (!this.delayedHandle) {
            // Delay the trigger so that it's only called once per bunch of changes instead of being called for each single change.
            this.delayedHandle = setTimeout(() => {
                delete this.delayedHandle;
                this.subscribers.forEach(function (subscriber) {
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
                `INSERT OR IGNORE INTO tag(id) values ${tags.map(() => "(?)").join(" ")};`,
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
        return this.run(
            `INSERT OR IGNORE INTO tag(id) values ${tags.map(() => "(?)").join(" ")};`,
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
                    todo(id, task_id) values (?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    task_id=?
                ;`,
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

            return this.run(
                `INSERT OR IGNORE INTO 
                    todo(id, task_id) values (?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    task_id=?
                ;`,
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

        const sql = `SELECT * FROM task ${where.length ? `WHERE ${where.join(" AND ")}` : ""};`;

        return this.all(sql, params);
    }

    async getTasksJSONAPI(filter, taskID) {
        return tasksToJSONAPI(await getTasks(filter, taskID));
    }

}

module.exports = DB;

