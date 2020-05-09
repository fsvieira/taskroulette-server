const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");


router.get("/sprints/:sprintID?", async (req, res) => {
    try {
        const { username, sprintID } = req.params;
        const db = new DB(username);
        const conn = await db.conn();

        const data = await new Promise((resolve, reject) => {
            conn.all(
                `SELECT * FROM sprint ${sprintID ? "WHERE id=?" : ""}`, [sprintID], (err, rows) => {
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

router.post("/sprints/", async (req, res) => {
    try {
        const { username } = req.params;
        const db = new DB(username);
        const conn = await db.conn();

        console.log(JSON.stringify(req.body));

        const {
            id,
            attributes: {
                createdAt,
                dueDate
            }, relationships: {
                tags: {
                    data: tags
                }
            }
        } = req.body;

        const sprintParams = [
            id,
            createdAt,
            dueDate
        ];

        const params = sprintParams
            .concat(sprintParams)
            .concat(tags.map(({ id }) => id))
            .concat(tags.map(({ id: tagID }) => [id, tagID]).reduce((acc, ids) => acc.concat(ids), []));

        const tagsInserts = `INSERT INTO tag(id) values ${tags.map(() => "(?)").join(" ")};`;
        const sprintTagsInserts = `INSERT INTO sprintTag(sprintID, tagID) values ${tags.map(() => "(?, ?)").join(" ")};`;

        conn.exec(
            `INSERT INTO sprint (
                id,
                createdAt=?,
                dueDate
            ) VALUES(
                ?,
                ?,
                ?
            )
            ON CONFLICT(id) DO UPDATE SET 
                id=?,
                createdAt=?,
                dueDate=?
            ;
            
            ${tagsInserts}
            ${sprintTagsInserts}
            
            `, params, (data, err) => {
                console.log(data, err);
                res.json(data);
                console.log(JSON.stringify(data));
            }
        );

    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }
});

module.exports = router;
