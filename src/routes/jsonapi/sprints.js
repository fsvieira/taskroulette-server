const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");


router.get("/sprints/:sprintID?", async (req, res) => {
    const { username, sprintID } = req.params;
    // const conn = await db.open(username, "sprints");
    const db = new DB(username);
    const conn = await db.conn;

    if (sprintID) {
        try {
            const sprint = await conn.get(sprintID);
            res.json(JSON.parse(sprint));
        }
        catch (e) {
            if (e.name === "NotFoundError") {
                res.json({ "todo": "Check spec for this!!" });
            }
            else {
                logger.error(e);
                res.status(500);
            }
        }

        db.close();
    }
    else {

        const ts = [];

        conn.createValueStream()
            .on("data", data => {
                ts.push(JSON.parse(data));
            })
            .on("error", error => {
                console.log(error);
                logger.error(error)
                res.status(500);
            })
            .on("close", () => db.close())
            .on("end", () => {
                res.json({ data: ts });
            });
    }
});

router.post("/sprints/:sprintID?", async (req, res) => {
    try {
        const db = new DB(username);
        const conn = await db.conn;

        const sql = `
        REPLACE INTO sprint(id, dueDate)
        VALUES(?, ?);
    `;

        const order = ["id", "dueDate"];

        const r = await new Promise((resolve, reject) => {
            conn.run(sql, order.map(label => req.body[label]), err => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(this.lastID);
                }
            });
        });

        console.log(r);

        res.json({ id: r });
    }
    catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }
});

module.exports = router;
