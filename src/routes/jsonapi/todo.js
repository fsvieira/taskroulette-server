const { logger } = require("../../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });
const DB = require("../../db/db");

const auth = require("../../utils/auth");

router.get("/todos/:todoID?", auth.required, async (req, res) => {
    try {
        const { todoID } = req.params;
        const userID = req.body.user.userID;
        const db = new DB(userID);
        const conn = await db.conn();

        const data = await new Promise((resolve, reject) => {
            conn.all(
                `SELECT * FROM todo WHERE id=?`, [todoID], (err, rows) => {
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


router.post("/todos/", auth.required, async (req, res) => {
    try {
        const userID = req.body.user.userID;
        const db = new DB(userID);

        const todo = await db.updateTodo(req.body);

        res.json(todo);
    } catch (e) {
        console.log(e);
        logger.error(e);
        res.status(500);
    }
});

module.exports = router;
