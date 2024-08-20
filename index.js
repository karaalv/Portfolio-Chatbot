/* API key import */
import { config } from "dotenv";
config();

import express from "express";
import { chatBotInterface, clearSessionFromDataBase, currentConversations, existsInSTM } from "./chatbot.js";
import session from "express-session";

/**
 * Configure express server
 */
const app = express();
app.use(express.json(),
        session({
            secret: "SECRET_KEY",
            resave: false, 
            saveUninitialized: false
        })
);

const activeSessions = {}
const port = process.env.PORT || 3000;
/**
 * API configuration settings
 */
const apiConfig = {
    sessionCapacity: 3,
    cleanUpInterval_ms: 180000, 
    inactiveLimit_mins: 1
}

/**
 * API key middleware to protect server
 */
const apiKeyMiddleware = (request, response, next) => {
    const providedAPIKey = request.header('API-KEY');

    if(!providedAPIKey || providedAPIKey !== process.env.MY_API_KEY){
        return response.status(401).send({error: "Invalid API key"})
    }

    next();
};

/**
 * Server load monitor 
 */
const serverLoadMiddleware = (request, response, next) => {
    if(Object.keys(activeSessions).length >= apiConfig.sessionCapacity){
        response.status(503).send({message: "Server at capacity, please try again later"})
        return;
    }

    next();
}

app.use(apiKeyMiddleware)

/**
 * Instantiate a chat session
 */
app.get("/chat", serverLoadMiddleware, (request, response) => {
    if(!request){
        response.status(400).send({message: "No request sent"});
        return;
    }

    const conversationId = request.session.id;
    activeSessions[conversationId] = {timestamp: new Date()};

    const path = `/post/${conversationId}`;
    console.log(path);
    response.status(200).send({message: "API session created"});
    // response.redirect(path);
})

/**
 * Create api request with new session
 */
app.post("/post/:id", serverLoadMiddleware, async (request, response) => {

    const requestData = request.body;
    const requestPayload = request.body.payload;
    const conversationId = request.params.id;

    if (conversationId === "") {
        response.status(400).send({ status: false, message: "Null conversation id" })
        return;
    }

    console.log(`Request from: ${conversationId}`);

    let chatResponse = "";
    let chatRequest = "";
    let statusCode = "";

    try {
        chatResponse = await chatBotInterface(requestPayload, conversationId);
        chatRequest = "Success";
        statusCode = 200;
    } catch {
        chatRequest = "Chat Interface Failure";
        statusCode = 500;
    }

    const res = {
        message: "Input received",
        request: requestData,
        requestPayload: requestPayload,
        chatAPIresponse: chatResponse,
        chatRequest: chatRequest
    }

    activeSessions[conversationId] = {timestamp: new Date()};
    response.status(statusCode).send(res);
});

/**
 * Obtain a list of active sessions
 */
app.get("/active-sessions", (request, response) => {
    console.log("Active sessions:");
    console.log(activeSessions);
    console.log("Current STM: ");
    currentConversations();
    response.status(200).send({message: "Log printed on console"})
});

/**
 * Clear session instance in buffer memory.
 */
app.delete("/clear/:id", (request, response) => {
    const conversationId = request.params.id;

    if (conversationId === "") {
        response.status(400).send({ status: false, message: "Null conversation id" })
        return
    }
    
    if(clearSessionFromDataBase(conversationId)){
        delete activeSessions[conversationId]
        response.status(200).send({message: "Session history cleared code: 1"});
    } else {
        if(!existsInSTM(conversationId)){
            delete activeSessions[conversationId]
            response.status(200).send({message: "Session history cleared code: 2"});
        } else {
            response.status(500).send({message: "Unable to delete from chat interface"});
        }
    }
})

/**
 * Configure automatic cleanup 
 */
function cleanUp(){
    console.log("Commencing Self cleanup...");
    if(Object.keys(activeSessions).length == 0){
        console.log("Sessions empty, cleanup exit.")
    } else {
        for (let sessionId in activeSessions){
            let timestamp = activeSessions[sessionId].timestamp;
            if(timeComparison(timestamp)){
                console.log(`clearing inactive chat ID: ${sessionId}`)
                if(clearSessionFromDataBase(sessionId)){
                    console.log("Cleared from STM");
                    delete activeSessions[sessionId]
                    console.log("Cleared from active sessions")
                } else {
                    console.log(`WARNING: Invalid delete from STM, session may still be using resources ID: ${sessionId}`)
                    if(!existsInSTM(sessionId)){
                        console.log(`Session of ID: ${sessionId} does not exist in STM database, clearing from active session list`)
                        delete activeSessions[sessionId]
                    } else {
                        console.log(`ERROR: Session exists in STM, Unable to clean memory on ID: ${sessionId}`)
                    }
                }
            }
        }
        console.log("Cleanup operation completed.")
    }
}

function timeComparison(date){
    const now = new Date();
    const timeDifference = now.getTime() - date.getTime();
    const minutesDifference = timeDifference / (1000*60);
    if(minutesDifference >= apiConfig.inactiveLimit_mins){
        return true;
    } else {
        return false;
    }
}

/**
 * Set cleanup interval
 */
setInterval(cleanUp, apiConfig.cleanUpInterval_ms);

app.listen(port, () => {
    console.log(`Listening on port: ${port}`)
});