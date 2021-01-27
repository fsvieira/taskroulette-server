const path = require("path");
const mkdirp = require("mkdirp");
const sqlite3 = require("sqlite3");
const crypto = require("crypto");


const dir = path.join(process.cwd(), "dbs");
const file = path.join(dir, "users.sqlite");
const ITERATIONS = 1000;

let db;

async function open() {
    return new Promise(async (resolve, reject) => {
        if (!db) {
            await mkdirp(dir);

            db = new sqlite3.Database(file,
                sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                err => {
                    if (err) {
                        reject(err);
                    }
                }
            );

            db.serialize(() => {
                // -- User
                db.run(`CREATE TABLE IF NOT EXISTS user (
                        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT UNIQUE,
                        email TEXT UNIQUE,
                        hash TEXT,
                        salt TEXT,
                        expiration_date INTEGER(4),
                        created_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now')), 
                        updated_at INTEGER(4) NOT NULL DEFAULT (strftime('%s','now'))
                    )`);
            });

        }

        resolve(db);
    });
}

async function conn() {
    db = db || await open();

    return db;
}

function sha512(password, salt) {
    return new Promise((resolve, reject) =>
        crypto.pbkdf2(
            password, salt, ITERATIONS, 64, 'sha512',
            (err, derivedKey) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(derivedKey.toString('hex'));
                }
            }
        )
    );
}

// Gen and save
async function hashPassword(password) {
    const salt = crypto.randomBytes(128).toString('base64');
    const hash = await sha512(password, salt);

    return {
        salt: salt,
        hash: hash
    };
}

async function isPasswordCorrect(savedHash, savedSalt, passwordAttempt) {
    return savedHash === await sha512(passwordAttempt, savedSalt);
}
async function getUserInfo(userID) {
    return new Promise(async (resolve, reject) => (await conn()).get(
        `SELECT * FROM user WHERE user_id=?`,
        [userID],
        async (err, row) => {
            if (err) {
                reject(err);
            }
            else if (row) {
                const { hash, salt, password, ...userInfo } = row;
                resolve(userInfo);
            }
            else {
                reject("USER_NOT_FOUND");
            }
        }
    ));
}

async function getUser(login, password) {
    // await register(login, 'sv.filipe@gmail.com', password);

    return new Promise(async (resolve, reject) => (await conn()).get(
        `SELECT user_id AS userID, email, username, hash, salt, expiration_date AS expirationDate FROM user WHERE 
            (username=? OR email=?) AND expiration_date > strftime('%s','now')         
        `,
        [login, login],
        async (err, row) => {
            if (err) {
                reject(err);
            }
            else if (row) {
                const { hash, salt, ...userInfo } = row;

                console.log(JSON.stringify(userInfo), JSON.stringify(row));

                if (await isPasswordCorrect(hash, salt, password)) {
                    resolve(userInfo);
                }
                else {
                    reject("WRONG_PASSWORD");
                }
            }
            else {
                reject("USER_NOT_FOUND");
            }
        }
    ));
}

function save(username, email, hash, salt) {
    return new Promise(async (resolve, reject) => (await conn()).run(
        `INSERT INTO user (username, email, hash, salt, expiration_date) VALUES (?, ?, ?, ?, strftime('%s', 'now', '+60 day'))`,
        [
            username,
            email,
            hash,
            salt
        ],
        (err, row) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(row);
            }
        }
    ));
}

async function register(username, email, password) {
    const { salt, hash } = await hashPassword(password);

    return save(username, email, hash, salt);
}

// register("fsvieira", "sv.filipe@gmail.com", "xpto");

module.exports = {
    getUser,
    register,
    getUserInfo
};

