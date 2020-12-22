const path = require("path");
const mkdirp = require("mkdirp");
const sqlite3 = require("sqlite3");
const crypto = require("crypto");


const dir = path.join(process.cwd(), "dbs");
const file = path.join(dir, "users.sqlite");
const ITERATIONS = 10000;
const DIGEST = "sha256";

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
                        username TEXT PRIMARY KEY,
                        email TEXT UNIQUE,
                        hash TEXT,
                        salt TEXT
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

async function getUsername(login, password) {
    // await register(login, 'sv.filipe@gmail.com', password);

    return new Promise(async (resolve, reject) => (await conn()).get(
        `SELECT username, hash, salt FROM user WHERE 
            username=? OR 
            email=?            
        `,
        [login, login],
        async (err, row) => {
            if (err) {
                console.log(e);
                reject(err);
            }
            else if (row) {
                const { username, hash, salt } = row;

                if (await isPasswordCorrect(hash, salt, password)) {
                    resolve(username);
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
        `INSERT INTO user (username, email, hash, salt) VALUES (?, ?, ?, ?)`,
        [
            username,
            email,
            hash,
            salt
        ],
        (err, row) => {
            console.log(err, JSON.stringify(row));

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

module.exports = {
    getUsername,
    register
};

