const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");

router.get("/tasks/:taskID?", async (req, res) => {
    try {
        const { username, taskID } = req.params;
        const db = new DB(username);
        const conn = await db.conn();
        const filter = req.query.filter;

        console.log(filter);

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

        console.log(sql);

        const data = await new Promise((resolve, reject) => {
            conn.all(
                sql,
                params,
                (err, rows) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(rows);
                    }
                });
        });

        res.json({ data });

        console.log("DATA", data);
    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }

});


router.post("/tasks/", async (req, res) => {
    try {
        const { username } = req.params;
        const db = new DB(username);
        const conn = await db.conn();

        console.log(JSON.stringify(req.body));

        const {
            id,
            attributes: {
                description,
                done,
                deleted,
                doneUntil,
                createdAt,
                updatedAt
            }, relationships: {
                tags: {
                    data: tags
                }
            }
        } = req.body;

        const taskParams = [
            id,
            description,
            done,
            deleted,
            doneUntil,
            createdAt,
            updatedAt
        ];

        const params = taskParams
            .concat(taskParams)
            .concat(tags.map(({ id }) => id))
            .concat(tags.map(({ id: tagID }) => [id, tagID]).reduce((acc, ids) => acc.concat(ids), []));

        const tagsInserts = `INSERT INTO tag(id) values ${tags.map(() => "(?)").join(" ")};`;
        const taskgTagsInserts = `INSERT INTO taskTag(taskID, tagID) values ${tags.map(() => "(?, ?)").join(" ")};`;

        conn.exec(
            `INSERT INTO tasks (
                id,
                description,
                done,
                deleted,
                doneUntil,
                createdAt,
                updatedAt
            ) VALUES(
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?
            )
            ON CONFLICT(id) DO UPDATE SET 
                id=?,
                description=?,
                done=?,
                deleted=?,
                doneUntil=?,
                createdAt=?,
                updatedAt=?
            ;
            
            ${tagsInserts}
            ${taskgTagsInserts}
            
            `, params, (data, err) => {
                res.json(data);
                console.log(JSON.stringify(data));
            }
        );

    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }
})

module.exports = router;
