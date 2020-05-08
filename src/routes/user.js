const jwt = require('jsonwebtoken');
const { logger } = require("../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });

const { SECRET } = process.env;

router.post("/login", async (req, res) => {
    console.log("LOGIN!!");
    const { username, password } = req.body;

    try {
        const token = jwt.sign({ username }, SECRET);

        res.json({ token, user: { username } });
    }
    catch (e) {
        logger.error(e);
        res.status(500);
    }
});

module.exports = router;
