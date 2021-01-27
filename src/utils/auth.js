const { logger } = require("../logger");
const { getUser } = require("./db");
const jwt = require("jsonwebtoken");

const SECRET = process.env.SECRET;

function unauthorized(res) {
    res.status(401).send("Unauthorized");
}

function required(req, res, next) {
    const auth = req.get("authorization");

    console.log(`GET AUTH => ${JSON.stringify(auth)}`);

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
                        console.log(JSON.stringify(user));
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
        { user: { ...user, forever } },
        SECRET,
        forever ? undefined : { expiresIn: 60 * 14 }
    );
}


module.exports = {
    required,
    token,
    getUser
};


