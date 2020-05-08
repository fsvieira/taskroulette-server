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
        const deleted = filter && filter.deleted === 'true';

        const data = await new Promise((resolve, reject) => {
            conn.all(
                "SELECT * FROM task WHERE deleted=:deleted;", {
                    deleted
                }, (err, rows) => {
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

        const data = await conn.run(
            `REPLACE INTO task (
                id,
                description,
                done,
                deleted,
                doneUntil,
                createdAt,
                updatedAt
            ) values (
                :id,
                :description,
                :done,
                :deleted,
                :doneUntil,
                :createdAt,
                :updatedAt
            )`, req.body
        );

        console.log(JSON.stringify(data));

        res.json(data);
    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }
})

module.exports = router;
