/*
const http = require('http');
const { app, bayeux } = require("./src/app");
const { logger } = require("./src/logger");

// const server = app.listen(9000); // http.createServer(app);
const { PORT } = process.env;

const server = app.listen(PORT); // http.createServer(app);

bayeux.attach(server);
// server.listen(PORT);

logger.info("Server started at port " + server.address().port + "; TODO: logger!!");

*/

require('dotenv').config();
const { PORT } = process.env;


const app = require("./src/app");

app.listen(PORT, () => console.log(`Example app listening at http://localhost:${PORT}`))

