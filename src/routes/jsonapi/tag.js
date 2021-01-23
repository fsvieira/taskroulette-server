const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");

const auth = require("../../utils/auth");

router.get("/tags/:tagID?", auth.required, async (req, res) => {
    try {
        const { tagID } = req.params;
        const userID = req.body.user.userID;
        const db = new DB(userID);
        const conn = await db.conn();

        const data = await new Promise((resolve, reject) => {
            conn.all(
                `SELECT * FROM tags ${tagID ? "WHERE id=?" : ""};`, [tagID], (err, rows) => {
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


router.post("/tags/", auth.required, async (req, res) => {
    const userID = req.body.user.userID;
    const db = new DB(userID);
    const conn = await db.conn();

    console.log(JSON.stringify(req.body));

    const { data: { id } } = req.body;

    conn.run(
        "INSERT OR IGNORE INTO tag(id) VALUES (?);", [id], err => {
            if (err) {
                logger.error(err);
                res.status(500);
            }
            else {
                res.json({ data: { type: "tag", id } });
            }
        }
    );
});


module.exports = router;
