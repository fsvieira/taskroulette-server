const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");


router.get("/tags/:tagID?", async (req, res) => {
    try {
        const { username, tagID } = req.params;
        const db = new DB(username);
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

module.exports = router;
