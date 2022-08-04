import express from "express";
import { DiscordRequest, VerifyDiscordRequest } from "./utils.js";
import { connectToGateway } from "./webSocketConnection.js";
import { handleMessageReception } from "./messageReception.js";
import fetch from "node-fetch";

// Create an express app
const app = express();

app.listen(3000, async () => {
  console.log("Listening on port 3000");
  
  await connectToGateway();
});
