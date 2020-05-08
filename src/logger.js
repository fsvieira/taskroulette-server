const packageJSON = require("../package.json");
const winston = require("winston");

const { combine, timestamp, label, printf } = winston.format;

const myFormat = printf(info => {
    return `${info.timestamp} [${info.label}] ${info.level}: ${JSON.stringify(info.message)}`;
});

module.exports = {
    logger: winston.createLogger({
        level: "info",
        format: combine(
            label({ label: packageJSON.name + " " + packageJSON.version }),
            timestamp(),
            myFormat
        ),
        transports: [
            //
            // - Write to all logs with level `info` and below to `combined.log` 
            // - Write all logs error (and below) to `error.log`.
            //
            new winston.transports.File({
                filename: "./logs/error.log",
                level: "error",
                maxsize: 1024 * 1000,
                maxFiles: 10
            }),
            new winston.transports.File({
                filename: "./logs/combined.log",
                maxsize: 1024 * 1000,
                maxFiles: 10
            })
        ]
    })
};

