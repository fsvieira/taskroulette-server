const path = require("path");
const mkdirp = require("mkdirp");
const sqlite3 = require("sqlite3");

const dbs = {};

class DB {
    constructor(username) {
        this.username = username;
        this.dir = path.join(process.cwd(), "dbs", username);
        this.file = path.join(this.dir, "db.sqlite");
    }

    async conn() {
        if (this._conn) {
            return this._conn;
        }

        const db = dbs[this.file] = dbs[this.file] || {
            conn: await this.open(),
            count: 0
        };

        db.count++;

        this._conn = db.conn;

        return this._conn;
    }

    async open() {
        return new Promise(async (resolve, reject) => {
            let db = dbs[this.file];
            if (!db) {
                await mkdirp(this.dir);

                db = new sqlite3.Database(this.file,
                    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                    err => {
                        if (err) {
                            reject(err);
                        }
                    }
                );


                /*
                {
	models: {
		task: {
			attributes: {
				description: { type: "string" },
				done: { type: "boolean" },
				deleted: { type: "boolean" },
				doneUntil: { type: "date-time" },
				createdAt: { type: "date-time" },
				updatedAt: { type: "date-time" }
			},
			relationships: {
				tags: { type: "hasMany", model: "tag" }
			}
		},
		tag: {},
		sprint: {
			attributes: {
				createdAt: { type: "date-time" },
				dueDate: { type: "date-time" },
			},
			relationships: {
				tags: { type: "hasMany", model: "tag" }
			}
		},
		todo: {
			relationships: {
				tags: { type: "hasMany", model: "tag" },
				task: { type: "hasOne", model: "task" }
			}
		}
	}
}*/

                db.serialize(() => {
                    // -- Tasks
                    db.run(`CREATE TABLE IF NOT EXISTS task (
                        id TEXT PRIMARY KEY,
                        description TEXT,
                        done INTEGER(1) DEFAULT 0,
                        deleted INTEGER(1) DEFAULT 0,
                        done_until INTEGER(4),
                        created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                        updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now'))
                    )`);

                    // -- Tags
                    db.run(`CREATE TABLE IF NOT EXISTS tag (
                        id TEXT PRIMARY KEY
                    )`);

                    // -- Relation tasks <-> tags
                    db.run(`CREATE TABLE IF NOT EXISTS task_tags (
                        task_id TEXT,
                        tag_id TEXT,
                        FOREIGN KEY(task_id) REFERENCES task(id)
                        FOREIGN KEY(tag_id) REFERENCES tag(id)
                        PRIMARY KEY(task_id, tag_id)
                    )`);

                    // -- Sprints
                    db.run(`CREATE TABLE IF NOT EXISTS sprint (
                        id TEXT PRIMARY KEY,
                        created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                        due_date INTEGER(4)
                    )`);

                    // -- Relation Sprint <-> tags
                    db.run(`CREATE TABLE IF NOT EXISTS sprint_tags (
                        sprint_id TEXT,
                        tag_id TEXT,
                        FOREIGN KEY(sprint_id) REFERENCES sprint(id)
                        FOREIGN KEY(tag_id) REFERENCES tag(id)
                        PRIMARY KEY(sprint_id, tag_id)
                    )`);

                    // -- Todo
                    db.run(`CREATE TABLE IF NOT EXISTS todo (
                        id TEXT PRIMARY KEY,
                        task_id TEXT,
                        FOREIGN KEY("task_id") REFERENCES task(id)
                    )`);
                });

            }

            resolve(db);
        });
    }

    close() {
        if (this._conn) {
            setTimeout(() => {
                const db = dbs[this.path];

                if (db) {
                    db.count--;

                    if (db.count === 0) {
                        this._conn.close();
                        this._conn = undefined;
                        delete dbs[this.file];
                    }
                }
            }, 5000);
        };
    }

    async addTags(tags) {
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
        });
    }

    async updateTodo({ id, relationships: { task: { id: taskID } } }) {
        const conn = await this.db.conn();

        return new Promise((resolve, reject) => {
            conn.run(
                `INSERT OR IGNORE INTO todo(id, task_id) values (?, ?);`,
                [id, taskID],
                err => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(todo);
                    }
                }
            );
        });
    }
}

module.exports = DB;

