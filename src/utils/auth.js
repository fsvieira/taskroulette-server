const { logger } = require("../logger");
const { getUsername } = require("./db");
const jwt = require("jsonwebtoken");

const SECRET = process.env.SECRET;

function unauthorized(res) {
    res.status(401).send("Unauthorized");
}

function required(req, res, next) {
    const auth = req.get("authorization");

    if (auth) {
        const [type, token] = auth.split(" ");

        if (type === "Bearer") {
            try {
                jwt.verify(token, SECRET, (err, decoded) => {
                    if (err) {
                        logger.error(err);
                        unauthorized(res);
                    }
                    else {
                        const user = decoded.user;
                        req.body.user = user;
                        next();
                    }
                });
            }
            catch (e) {
                logger.error(e);
                unauthorized(res);
            }
        }
        else {
            logger.error("Bad Auth token!");
            unauthorized(res);
        }
    }
    else {
        logger.error("No auth header!");
        unauthorized(res);
    }
}

function token(user, forever) {

    return jwt.sign(
        { user },
        SECRET,
        forever ? undefined : { expiresIn: 60 * 60 * 4 }
    );
}


module.exports = {
    required,
    token,
    getUsername
};


