const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");
const moment = require("moment");

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

        console.log("TODO: send it on jsonapi format!!");

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
                "created-at": createdAt,
                "due-date": dueDate
            }, relationships: {
                tags: {
                    data: tags
                }
            }
        } = req.body;

        const sprintParams = [
            id,
            moment.utc(createdAt).unix(),
            moment.utc(dueDate).unix()
        ];

        const params = sprintParams
            .concat(sprintParams)
            .concat(tags.map(({ id }) => id))
            .concat(tags.map(({ id: tagID }) => [id, tagID]).reduce((acc, ids) => acc.concat(ids), []));

        const tagsInserts = `INSERT INTO tag(id) values ${tags.map(() => "(?)").join(" ")};`;
        const sprintTagsInserts = `INSERT INTO sprint_tag(sprint_id, tag_id) values ${tags.map(() => "(?, ?)").join(" ")};`;

        conn.exec(
            `INSERT INTO sprint (
                id,
                created_at,
                due_date
            ) VALUES(
                ?,
                ?,
                ?
            )
            ON CONFLICT(id) DO UPDATE SET 
                id=?,
                created_at=?,
                due-date=?
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
