const { logger } = require("../logger");

const express = require("express");
const router = express.Router({ mergeParams: true });

const auth = require("../utils/auth");

router.post("/login", async (req, res) => {
    try {

        const {
            data: {
                id: login, attributes: { password, forever }
            }
        } = req.body;

        const username = await auth.getUsername(login, password);

        const token = auth.token({ username }, forever);

        res.json({ token, user: { username } });
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
