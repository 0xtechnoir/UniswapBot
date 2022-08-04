import WebSocket from "ws";
import { DiscordRequest } from "./utils.js";
import { GatewayOpcodes, GatewayDispatchEvents } from "discord-api-types/v9";
import btoa from "btoa";
import { handleMessageReception } from "./messageReception.js";

let receivedAck = true;
let currentSequence = null;
let currentSession = null;
let invervalId = null;
let token = "";

export async function connectToGateway(canResume) {
  token = await getUserToken();
  const url = await getGatewayUrl();
  let socket = new WebSocket(`${url}/?v=9&encoding=json`);

  socket.on("message", function (event) {
    const strEvent = arrayBufferToBase64(event);
    const eventObj = JSON.parse(strEvent);

    switch (eventObj.op) {
      case GatewayOpcodes.Hello:
        receivedAck = true;
        invervalId = setInterval(
          sendHeartbeat,
          eventObj.d.heartbeat_interval,
          socket,
          currentSequence,
          false
        );

        if (canResume) {
          resume(socket);
        } else {
          identify(socket);
        }
        break;
      case GatewayOpcodes.HeartbeatAck:
        receivedAck = true;
        break;
      case GatewayOpcodes.Heartbeat:
        sendHeartbeat(socket, currentSequence, true);
        break;
      case GatewayOpcodes.InvalidSession:
        handleInvalidSession(socket, eventObj.d);
        break;
      case GatewayOpcodes.Dispatch:
        handleDispatch(eventObj);
        break;
    }

    //console.log(eventObj.op);
  });
}

async function getGatewayUrl() {
  const res = await DiscordRequest(`/gateway`, token, { method: "GET" });
  const response = await res.json();

  return response.url;
}

function sendHeartbeat(socket, sequence, force) {
  if (!force && !receivedAck) {
    reconnect(socket);
    return;
  }

  const heartbeat = {
    op: GatewayOpcodes.Heartbeat,
    d: sequence,
  };
  socket.send(JSON.stringify(heartbeat));
  receivedAck = false;
}

function identify(socket) {
  const identity = {
    op: GatewayOpcodes.Identify,
    d: {
      token: token,
      intents: (1 << 9) | (1 << 15),
      properties: {
        $os: "linux",
        $browser: "CryptoBot",
        $device: "CryptoBot",
      },
    },
  };

  currentSequence = null;

  socket.send(JSON.stringify(identity));
}

function handleDispatch(event) {
  switch (event.t) {
    case GatewayDispatchEvents.Ready:
      currentSession = event.d.session_id;
      break;
    case GatewayDispatchEvents.MessageCreate:
      if ( event.d.channel_id == "1002199996956950658" ||
        (event.d.channel_id == "955712588610678784" 
          && event.d.author.id == "458659786926587941")
      ) {
        console.log(event.d.member.id);
        handleMessageReception(event.d.content, token);
      }
      break;
  }

  if (currentSequence == null || event.s > currentSequence) {
    currentSequence = event.s;
  }
}

function reconnect(socket) {
  console.log("Session interrupted. Need to reconnect");
  clearInterval(invervalId);

  socket.terminate();
  connectToGateway(true);
}

function resume(socket) {
  const resumeObj = {
    op: GatewayOpcodes.Resume,
    d: {
      token: token,
      session_id: currentSession,
      seq: currentSession,
    },
  };

  socket.send(JSON.stringify(resumeObj));
}

function handleInvalidSession(socket, resumable) {
  console.log("Invalid session. Retrying in 5 seconds");
  socket.terminate();
  clearInterval(invervalId);

  setTimeout(function () {
    connectToGateway(resumable);
  }, 5000);
}

function arrayBufferToBase64(buffer) {
  let bytes = new Uint8Array(buffer);

  return bytes.reduce(
    (acc, i) => (acc += String.fromCharCode.apply(null, [i])),
    ""
  );
}

async function getUserToken() {
    
  const request = await DiscordRequest(`/auth/login`, token, {
    method: "POST",
    body: {
      captcha_key: null,
      gift_code_sku_id: null,
      login: "frankclaassen88@gmail.com",
      login_source: null,
      password: "Turnkey12345!",
      undelete: false,
    },
  });

  const response = await request.json();

  return response.token;
}
