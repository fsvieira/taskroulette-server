const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");
const moment = require("moment");

async function getTask(db, taskID, filter) {
    const data = await db.getTasks(filter, taskID);

    const json = data.map(({
        id,
        done,
        deleted,
        done_until,
        created_at,
        updated_at,
        ...attr
    }) => ({
        id,
        type: "task",
        attributes: {
            done: !!done,
            deleted: !!deleted,
            "done-until": done_until ? moment.unix(done_until).valueOf() : null,
            "created-at": moment.unix(created_at).valueOf(),
            "updated-at": moment.unix(updated_at).valueOf(),
            ...attr
        },
        relationships: {
            // TODO: get tags.
            tags: {
                data: [{ type: "tag", id: "all" }]
            }
        }
    }));

    return { data: json };
}

router.get("/tasks/:taskID?", async (req, res) => {
    try {
        const { username, taskID } = req.params;
        const db = new DB(username);
        const filter = req.query.filter;

        res.json(await getTask(db, filter, taskID));
    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }

});

router.post("/tasks/", async (req, res) => {
    const { username } = req.params;
    const db = new DB(username);
    const conn = await db.conn();

    console.log(JSON.stringify(req.body));

    const {
        data: {
            id,
            attributes: {
                description,
                done,
                deleted,
                "done-until": doneUntil,
                "created-at": createdAt,
                "updated-at": updatedAt
            }, relationships: {
                tags: {
                    data: tags
                }
            }
        }
    } = req.body;

    const taskParams = [
        id,
        description,
        done,
        deleted,
        doneUntil ? moment.utc(doneUntil).unix() : undefined,
        moment.utc(createdAt).unix(),
        moment.utc(updatedAt).unix()
    ];

    const insertTask = `INSERT INTO task (
            id,
            description,
            done,
            deleted,
            done_until,
            created_at,
            updated_at
        ) VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
        );
    `;

    conn.run(
        insertTask,
        taskParams,
        err => {
            if (err) {
                logger.error(err);
                console.log(err, insertTask);
                res.status(500);
            }
            else if (tags.length) {
                const insertTaskTags = `INSERT OR IGNORE INTO task_tags(task_id, tag_id) values ${tags.map(() => "(?, ?)").join(", ")};`;
                conn.run(
                    insertTaskTags,
                    tags.map(({ id: tagID }) => [id, tagID]).reduce((acc, ids) => acc.concat(ids), []),
                    err => {
                        if (err) {
                            logger.error(err);
                            console.log(err, insertTaskTags);
                            res.status(500);
                        }
                        else {
                            res.json(req.body);
                        }
                    }
                )
            }
            else {
                res.json(req.body);
            }
        }
    );
})

// TODO: it should return everything like a get request. 
router.patch("/tasks/:taskID?", async (req, res) => {
    try {
        const { username, taskID } = req.params;
        const db = new DB(username);
        const conn = await db.conn();

        console.log(JSON.stringify(req.body));

        const {
            data: {
                attributes: {
                    "updated-at": updatedAt
                }
            }
        } = req.body;

        console.log(taskID);

        const data = await new Promise((resolve, reject) =>
            conn.get(
                "SELECT * FROM task WHERE id=?",
                [taskID],
                (err, row) => err ? reject(err) : resolve(row)
            )
        );

        if (data.updated_at < updatedAt) {

            const {
                data: {
                    attributes: {
                        description = data.description,
                        done = data.done,
                        deleted = data.deleted,
                        "done-until": doneUntil = data.done_until ? moment.unix(data.done_until).valueOf() : undefined,
                        "created-at": createdAt = moment.unix(data.created_at).valueOf(),
                        "updated-at": updatedAt = moment.unix(data.updated_at).valueOf()
                    }, relationships: {
                        tags: {
                            data: tags = data.tags
                        }
                    }
                }
            } = req.body;

            const result = {
                data: {
                    id: taskID,
                    type: "task",
                    attributes: {
                        description,
                        done: !!done,
                        deleted: !!deleted,
                        "done-until": doneUntil ? moment.unix(doneUntil).valueOf() : null,
                        "created-at": moment.unix(createdAt).valueOf(),
                        "updated-at": moment.unix(updatedAt).valueOf(),
                    },
                    relationships: {
                        // TODO: get tags.
                        tags: {
                            data: tags
                        }
                    }
                }
            };

            const updateTask = `UPDATE task SET 
                    description=?,
                    done=?,
                    deleted=?,
                    done_until=?,
                    created_at=?,
                    updated_at=?
                WHERE id=?
                ;
            `;

            conn.run(
                updateTask,
                [
                    description,
                    done,
                    deleted,
                    doneUntil ? moment.utc(doneUntil).unix() : undefined,
                    moment.utc(createdAt).unix(),
                    moment.utc(updatedAt).unix(),
                    taskID
                ],
                err => {
                    if (err) {
                        logger.error(err);
                        console.log(err, updateTask);
                        res.status(500);
                    }
                    else if (tags.length) {
                        const deleteTaskTags = `DELETE FROM task_tags WHERE task_id=?;`
                        const insertTaskTags = `INSERT OR IGNORE INTO task_tags(task_id, tag_id) VALUES ${tags.map(() => "(?, ?)").join(", ")};`;

                        conn.run(
                            deleteTaskTags,
                            [taskID],
                            err => {
                                if (err) {
                                    res.status(500);
                                }
                                else {
                                    conn.run(
                                        insertTaskTags,
                                        tags.map(({ id: tagID }) => [taskID, tagID]).reduce((acc, ids) => acc.concat(ids), []),
                                        err => {
                                            if (err) {
                                                logger.error(err);
                                                console.log(err, insertTaskTags);
                                                res.status(500);
                                            }
                                            else {
                                                res.json(result);
                                            }
                                        }
                                    )
                                }
                            }
                        );
                    }
                    else {
                        res.json(result);
                    }
                }
            );
        }
        else {
            res.json(data);
        }
    }
    catch (e) {
        console.log(e);
        logger.error(e);
    }

});

module.exports = router;
