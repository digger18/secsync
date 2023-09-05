import {
  createEphemeralMessage,
  messageTypes,
} from "../ephemeralMessage/createEphemeralMessage";
import { EphemeralMessagesSession, SyncMachineConfig } from "../types";

export const websocketService =
  (
    context: SyncMachineConfig,
    ephemeralMessagesSession: EphemeralMessagesSession
  ) =>
  (send: any, onReceive: any) => {
    let ephemeralSessionCounter = ephemeralMessagesSession.counter;
    const prepareAndSendEphemeralMessage = async (
      data,
      messageType: keyof typeof messageTypes
    ) => {
      const publicData = {
        docId: context.documentId,
        pubKey: context.sodium.to_base64(context.signatureKeyPair.publicKey),
      };
      const ephemeralMessageKey = await context.getEphemeralMessageKey();
      const ephemeralMessage = createEphemeralMessage(
        data,
        messageType,
        publicData,
        ephemeralMessageKey,
        context.signatureKeyPair,
        ephemeralMessagesSession.id,
        ephemeralSessionCounter,
        context.sodium
      );
      ephemeralSessionCounter++;
      if (context.logging === "debug") {
        console.debug("send ephemeralMessage");
      }
      send({
        type: "SEND",
        message: JSON.stringify(ephemeralMessage),
        // Note: send a faulty message to test the error handling
        // message: JSON.stringify({ ...ephemeralMessage, ciphertext: "lala" }),
      });
    };

    let connected = false;

    // timeout the connection try after 5 seconds
    setTimeout(() => {
      if (!connected) {
        send({ type: "WEBSOCKET_DISCONNECTED" });
      }
    }, 5000);

    const knownSnapshotIdParam = context.knownSnapshotInfo
      ? `&knownSnapshotId={context.knownSnapshotInfo.id}`
      : "";

    const websocketConnection = new WebSocket(
      `${context.websocketHost}/${context.documentId}?sessionKey=${context.websocketSessionKey}${knownSnapshotIdParam}`
    );

    const onWebsocketMessage = async (event: any) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "document-not-found":
          send({ type: "WEBSOCKET_DOCUMENT_NOT_FOUND" });
          break;
        case "unauthorized":
          send({ type: "WEBSOCKET_UNAUTHORIZED" });
          break;
        case "document-error":
          send({ type: "WEBSOCKET_DOCUMENT_ERROR" });
          break;
        case "document":
          // At this point the server will have added the user to the active session of
          // the document, so we can start sending ephemeral messages.
          // An empty ephemeralMessage right away to initiate the session signing.
          // NOTE: There is no break and send with WEBSOCKET_ADD_TO_INCOMING_QUEUE is still invoked
          prepareAndSendEphemeralMessage(new Uint8Array(), "initialize").catch(
            (reason) => {
              if (context.logging === "debug" || context.logging === "error") {
                console.error(reason);
              }
              send({ type: "FAILED_CREATING_EPHEMERAL_UPDATE", error: reason });
            }
          );
        case "snapshot":
        case "snapshot-saved":
        case "snapshot-save-failed":
        case "update":
        case "update-saved":
        case "update-save-failed":
        case "ephemeral-message":
          send({ type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE", data });
          break;
        default:
          send({ type: "WEBSOCKET_ADD_TO_CUSTOM_MESSAGE_QUEUE", data });
      }
    };

    websocketConnection.addEventListener("message", onWebsocketMessage);

    websocketConnection.addEventListener("open", (event) => {
      connected = true;
      send({ type: "WEBSOCKET_CONNECTED", websocket: websocketConnection });
    });

    websocketConnection.addEventListener("error", (event) => {
      if (context.logging === "debug") {
        console.debug("websocket error", event);
      }
      send({ type: "WEBSOCKET_DISCONNECTED" });
    });

    websocketConnection.addEventListener("close", function (event) {
      if (context.logging === "debug") {
        console.debug("websocket closed");
      }
      send({ type: "WEBSOCKET_DISCONNECTED" });
    });

    onReceive((event: any) => {
      if (event.type === "SEND") {
        websocketConnection.send(event.message);
      }
      if (event.type === "SEND_EPHEMERAL_UPDATE") {
        try {
          prepareAndSendEphemeralMessage(event.data, event.messageType).catch(
            (reason) => {
              if (context.logging === "debug" || context.logging === "error") {
                console.error(reason);
              }
              send({ type: "FAILED_CREATING_EPHEMERAL_UPDATE", error: reason });
            }
          );
        } catch (error) {
          if (context.logging === "debug" || context.logging === "error") {
            console.error(error);
          }
          send({ type: "FAILED_CREATING_EPHEMERAL_UPDATE", error });
        }
      }
    });

    return () => {
      if (context.logging === "debug") {
        console.debug("CLOSE WEBSOCKET");
      }
      websocketConnection.close();
    };
  };
