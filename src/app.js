/**
 * This module is separated from server so that it can be tested without starting 
 * the listenner.
 */
require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const compression = require("compression");
const user = require("./routes/user");
const tasks = require("./routes/jsonapi/tasks");
const sprints = require("./routes/jsonapi/sprints");
const todo = require("./routes/jsonapi/todo");
const tag = require("./routes/jsonapi/tag");

const app = express();

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "HEAD,GET,POST,PATCH");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization,Accept");
    next();
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ type: "application/json" }));
app.use(compression());

// curl -d '{"username":"fsvieira", "password":"xpto"}' -H "Content-Type: application/json" -X POST http://localhost:9000/api/login
app.use("/api/", user);

app.use("/api/", tasks);
app.use("/api/", sprints);
app.use("/api/", todo);
app.use("/api/", tag);


app.get("/status", (req, res) => res.json({ status: "online" }));

module.exports = app;
