const { logger } = require("../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../utils/auth");

router.post("/login", async (req, res) => {
    try {
        console.log(req.body);
        const {
            id: login, password, forever
        } = req.body;

        const user = await auth.getUser(login, password);

        const token = auth.token({ userID: user.userID }, forever);

        res.json({ token, user });
    }
    catch (e) {
        logger.error(e);

        let code = 500;
        if (e === 'WRONG_PASSWORD') {
            code = 401;
        }
        else if (e === 'USER_NOT_FOUND') {
            code = 403;
        }

        res.status(code).send();
    }
});

module.exports = router;
