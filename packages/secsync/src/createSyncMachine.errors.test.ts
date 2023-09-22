import sodium, { KeyPair } from "libsodium-wrappers";
import { assign, interpret, spawn } from "xstate";
import { createSyncMachine } from "./createSyncMachine";
import { generateId } from "./crypto/generateId";
import { createEphemeralMessage } from "./ephemeralMessage/createEphemeralMessage";
import { createEphemeralSession } from "./ephemeralMessage/createEphemeralSession";
import { createEphemeralMessageProof } from "./ephemeralMessage/createEphemeralSessionProof";
import { createSnapshot } from "./snapshot/createSnapshot";
import {
  EphemeralMessagePublicData,
  SnapshotPublicData,
  SnapshotUpdateClocks,
  UpdatePublicData,
} from "./types";
import { createUpdate } from "./update/createUpdate";

const url = "wss://www.example.com";
const docId = "6e46c006-5541-11ec-bf63-0242ac130002";

let clientAKeyPair: KeyPair;
let clientAPublicKey: string;
let clientACounter: number;
let clientASessionId: string;
let clientAPublicData: EphemeralMessagePublicData;

let clientBKeyPair: KeyPair;
let clientBPublicKey: string;
let clientBSessionId: string;
let clientBPublicData: EphemeralMessagePublicData;

let key: Uint8Array;
let snapshotId: string;

beforeEach(async () => {
  await sodium.ready;

  clientAKeyPair = {
    privateKey: sodium.from_base64(
      "g3dtwb9XzhSzZGkxTfg11t1KEIb4D8rO7K54R6dnxArvgg_OzZ2GgREtG7F5LvNp3MS8p9vsio4r6Mq7SZDEgw"
    ),
    publicKey: sodium.from_base64(
      "74IPzs2dhoERLRuxeS7zadzEvKfb7IqOK-jKu0mQxIM"
    ),
    keyType: "ed25519",
  };
  clientAPublicKey = sodium.to_base64(clientAKeyPair.publicKey);
  clientAPublicData = {
    docId,
    pubKey: clientAPublicKey,
  };
  clientASessionId = generateId(sodium);
  clientACounter = 0;

  clientBKeyPair = {
    privateKey: sodium.from_base64(
      "ElVI9nkbOypSu2quCTXH1i1gGlcd-Sxd7S6ym9sNZj48ben-hOmefr13D9Y1Lnys3CuhwuPb6DMh_oDln913_g"
    ),
    publicKey: sodium.from_base64(
      "PG3p_oTpnn69dw_WNS58rNwrocLj2-gzIf6A5Z_dd_4"
    ),
    keyType: "ed25519",
  };
  clientBPublicKey = sodium.to_base64(clientBKeyPair.publicKey);
  clientBSessionId = generateId(sodium);
});

type CreateSnapshotTestHelperParams = {
  parentSnapshotId: string;
  parentSnapshotCiphertext: string;
  grandParentSnapshotProof: string;
  content: string;
  parentSnapshotUpdateClocks?: SnapshotUpdateClocks;
};

const createSnapshotTestHelper = (params?: CreateSnapshotTestHelperParams) => {
  snapshotId = generateId(sodium);
  const {
    parentSnapshotId,
    parentSnapshotCiphertext,
    grandParentSnapshotProof,
    content,
    parentSnapshotUpdateClocks,
  } = params || {};
  key = sodium.from_hex(
    "724b092810ec86d7e35c9d067702b31ef90bc43a7b598626749914d6a3e033ed"
  );

  const publicData: SnapshotPublicData = {
    snapshotId,
    docId,
    pubKey: clientAPublicKey,
    parentSnapshotId: parentSnapshotId || "",
    parentSnapshotUpdateClocks: parentSnapshotUpdateClocks || {},
  };

  const snapshot = createSnapshot(
    content || "Hello World",
    publicData,
    key,
    clientAKeyPair,
    parentSnapshotCiphertext || "",
    grandParentSnapshotProof || "",
    sodium
  );
  return {
    snapshot: {
      ...snapshot,
      serverData: { latestVersion: 0 },
    },
    key,
    signatureKeyPair: clientAKeyPair,
  };
};

type CreateUpdateTestHelperParams = {
  version: number;
  content?: string;
};

const createUpdateTestHelper = (params?: CreateUpdateTestHelperParams) => {
  const version = params?.version || 0;
  const content = params?.content || "u";
  const publicData: UpdatePublicData = {
    refSnapshotId: snapshotId,
    docId,
    pubKey: clientAPublicKey,
  };

  const update = createUpdate(
    content,
    publicData,
    key,
    clientAKeyPair,
    version,
    sodium
  );

  return { update: { ...update, serverData: { version } } };
};

const createEphemeralMessageTestHelper = ({
  messageType,
  receiverSessionId,
  content,
  key: customKey,
}: {
  messageType: "proof" | "message";
  receiverSessionId: string;
  content?: Uint8Array;
  key?: Uint8Array;
}) => {
  if (messageType === "proof") {
    const proof = createEphemeralMessageProof(
      receiverSessionId,
      clientASessionId,
      clientAKeyPair,
      sodium
    );

    const ephemeralMessage = createEphemeralMessage(
      proof,
      "proof",
      clientAPublicData,
      customKey || key,
      clientAKeyPair,
      clientASessionId,
      clientACounter,
      sodium
    );
    clientACounter++;
    return { ephemeralMessage };
  } else {
    const ephemeralMessage = createEphemeralMessage(
      content ? content : new Uint8Array([22]),
      "message",
      clientAPublicData,
      key,
      clientAKeyPair,
      clientASessionId,
      clientACounter,
      sodium
    );
    clientACounter++;
    return { ephemeralMessage };
  }
};

test("SECSYNC_ERROR_21 ephemeral message decryption failed", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      state.matches("connected.idle") &&
      state.context._ephemeralMessageReceivingErrors.length === 1
    ) {
      expect(state.context._ephemeralMessageReceivingErrors[0].message).toEqual(
        "SECSYNC_ERROR_21"
      );
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
    key: sodium.from_hex(
      "994b092810ec86d7e35c9d067702b31ef90bc43a7b598626749914d6a3e033ed"
    ),
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });
});

test("SECSYNC_ERROR_22 no verified session found", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      state.matches("connected.idle") &&
      state.context._ephemeralMessageReceivingErrors.length === 1
    ) {
      expect(state.context._ephemeralMessageReceivingErrors[0].message).toEqual(
        "SECSYNC_ERROR_22"
      );
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId = "WRONG_SESSION_ID";

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "message",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });
});

test("SECSYNC_ERROR_23 ignore an ephemeral message coming from a reply attack", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      ephemeralMessagesValue.length === 2 &&
      state.matches("connected.idle")
    ) {
      expect(ephemeralMessagesValue[0]).toEqual(22);
      // the message with 22 from the reply attack is ignored
      expect(ephemeralMessagesValue[1]).toEqual(55);
      expect(state.context._ephemeralMessageReceivingErrors.length).toEqual(1);
      expect(state.context._ephemeralMessageReceivingErrors[0].message).toEqual(
        "SECSYNC_ERROR_23"
      );
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });

  setTimeout(() => {
    const { ephemeralMessage: ephemeralMessage2 } =
      createEphemeralMessageTestHelper({
        messageType: "message",
        receiverSessionId,
      });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: {
        ...ephemeralMessage2,
        type: "ephemeral-message",
      },
    });
    setTimeout(() => {
      syncService.send({
        type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
        data: {
          ...ephemeralMessage2,
          type: "ephemeral-message",
        },
      });
      setTimeout(() => {
        const { ephemeralMessage: ephemeralMessage3 } =
          createEphemeralMessageTestHelper({
            messageType: "message",
            receiverSessionId,
            content: new Uint8Array([55]),
          });
        syncService.send({
          type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
          data: {
            ...ephemeralMessage3,
            type: "ephemeral-message",
          },
        });
      }, 1);
    }, 1);
  }, 1);
});

test("SECSYNC_ERROR_24 isValidClient throws", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  let isValidClientCounter = 0;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) => {
          if (isValidClientCounter === 1) {
            throw new Error("BREAK");
          }
          isValidClientCounter++;
          return true;
        },
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      state.matches("connected.idle") &&
      state.context._ephemeralMessageReceivingErrors.length === 1
    ) {
      expect(state.context._ephemeralMessageReceivingErrors[0].message).toEqual(
        "SECSYNC_ERROR_24"
      );
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });
});

test("SECSYNC_ERROR_24 isValidClient returns false", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  let isValidClientCounter = 0;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) => {
          if (isValidClientCounter === 1) {
            return false;
          }
          isValidClientCounter++;
          return true;
        },
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      state.matches("connected.idle") &&
      state.context._ephemeralMessageReceivingErrors.length === 1
    ) {
      expect(state.context._ephemeralMessageReceivingErrors[0].message).toEqual(
        "SECSYNC_ERROR_24"
      );
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });
});

test("SECSYNC_ERROR_26 process three additional ephemeral messages where the second is ignored since the docId has been manipulated", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      ephemeralMessagesValue.length === 1 &&
      state.matches("connected.idle")
    ) {
      expect(state.context._ephemeralMessageReceivingErrors.length).toEqual(1);
      // the message with 44 has been ignored
      expect(ephemeralMessagesValue[0]).toEqual(55);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });

  setTimeout(() => {
    const { ephemeralMessage: ephemeralMessage2 } =
      createEphemeralMessageTestHelper({
        messageType: "message",
        receiverSessionId,
        content: new Uint8Array([44]),
      });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: {
        ...ephemeralMessage2,
        publicData: {
          ...ephemeralMessage2.publicData,
          docId: "wrongDocId",
        },
        type: "ephemeral-message",
      },
    });
    setTimeout(() => {
      const { ephemeralMessage: ephemeralMessage3 } =
        createEphemeralMessageTestHelper({
          messageType: "message",
          receiverSessionId,
          content: new Uint8Array([55]),
        });
      syncService.send({
        type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
        data: {
          ...ephemeralMessage3,
          type: "ephemeral-message",
        },
      });
    }, 1);
  }, 1);
});

test("should ignore an update in case it's a reply attack with the same update", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          sodium.to_base64(clientAKeyPair.publicKey) === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (docValue === "Hello Worlduo") {
      // 'u' was only applied once
      expect(state.context._documentDecryptionState).toBe("complete");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  expect(syncService.getSnapshot().context._documentDecryptionState).toBe(
    "pending"
  );

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const { update } = createUpdateTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update,
      type: "update",
    },
  });

  // this is the reply attack update that should be ignored
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update,
      type: "update",
    },
  });

  const { update: update2 } = createUpdateTestHelper({
    version: 1,
    content: "o",
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update2,
      type: "update",
    },
  });
});

test("should ignore an update in case it's a different update, but the same clock", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          sodium.to_base64(clientAKeyPair.publicKey) === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (docValue === "Hello Worldub") {
      // 'a' between 'u' and 'b' was ignored
      expect(state.context._documentDecryptionState).toBe("complete");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  expect(syncService.getSnapshot().context._documentDecryptionState).toBe(
    "pending"
  );

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const { update } = createUpdateTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update,
      type: "update",
    },
  });

  const { update: update2 } = createUpdateTestHelper({
    version: 0,
    content: "a",
  });

  // this is the reply attack update that should be ignored
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update2,
      type: "update",
    },
  });

  const { update: update3 } = createUpdateTestHelper({
    version: 1,
    content: "b",
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...update3,
      type: "update",
    },
  });
});

test("set _documentDecryptionState to failed if not even the snapshot can be loaded", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => {
          throw new Error("INVALID");
        },
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("failed");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });
});

test("set _documentDecryptionState to partial and apply the first update, if document snapshot decrypts but the second update fails", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("partial");
      expect(docValue).toEqual("Hello Worldu");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [
        createUpdateTestHelper().update,
        createUpdateTestHelper({ version: 1000 }).update,
      ],
    },
  });
});

test("set _documentDecryptionState to partial, if document snapshot decrypts but the first update fails", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("partial");
      expect(docValue).toEqual("Hello World");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [createUpdateTestHelper({ version: 1000 }).update],
    },
  });
});

test("store not more than 20 receiving failed ephemeral message errors", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      ephemeralMessagesValue.length === 1 &&
      state.matches("connected.idle")
    ) {
      expect(state.context._ephemeralMessageReceivingErrors.length).toEqual(20);
      expect(ephemeralMessagesValue[0]).toEqual(22);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });

  const receiverSessionId =
    syncService.getSnapshot().context._ephemeralMessagesSession.id;

  const { ephemeralMessage } = createEphemeralMessageTestHelper({
    messageType: "proof",
    receiverSessionId,
  });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessage,
      type: "ephemeral-message",
    },
  });

  for (let step = 0; step < 25; step++) {
    const { ephemeralMessage: ephemeralMessageX } =
      createEphemeralMessageTestHelper({
        messageType: "message",
        receiverSessionId,
      });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: {
        ...ephemeralMessageX,
        signature: "BROKEN",
        type: "ephemeral-message",
      },
    });
  }

  const { ephemeralMessage: ephemeralMessageLast } =
    createEphemeralMessageTestHelper({
      messageType: "message",
      receiverSessionId,
    });
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      ...ephemeralMessageLast,
      type: "ephemeral-message",
    },
  });
});

test("reset the context entries after websocket disconnect", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.matches("connecting.retrying")) {
      expect(state.context._documentDecryptionState).toEqual("pending");
      expect(state.context._incomingQueue).toEqual([]);
      expect(state.context._customMessageQueue).toEqual([]);
      expect(state.context._snapshotInFlight).toEqual(null);
      expect(state.context._updatesInFlight).toEqual([]);
      expect(state.context._snapshotInfosWithUpdateClocks).toEqual([]);
      expect(state.context._updatesLocalClock).toEqual(-1);
      expect(state.context._ephemeralMessagesSession).not.toBe(null);
      expect(state.context._ephemeralMessageReceivingErrors).toEqual([]);
      expect(state.context._ephemeralMessageAuthoringErrors).toEqual([]);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
      updates: [
        createUpdateTestHelper().update,
        createUpdateTestHelper({ version: 1 }).update,
      ],
    },
  });

  syncService.send({
    type: "WEBSOCKET_DISCONNECTED",
  });
});

test("reconnect and reload the document", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();
  let reconnected = false;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (
      reconnected &&
      state.matches("connected.idle") &&
      state.context._documentDecryptionState
    ) {
      expect(docValue).toEqual("Hello Worlduu");
      expect(state.context._documentDecryptionState).toEqual("complete");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  const document = {
    type: "document",
    snapshot,
    updates: [
      createUpdateTestHelper().update,
      createUpdateTestHelper({ version: 1 }).update,
    ],
  };
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: document,
  });

  syncService.send({
    type: "WEBSOCKET_DISCONNECTED",
  });
  setTimeout(() => {
    syncService.send({ type: "WEBSOCKET_RETRY" });
    syncService.send({ type: "WEBSOCKET_CONNECTED" });
    syncService.send({
      type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
      data: document,
    });
    reconnected = true;
  }, 1);
});

test("store not more than 20 failed creating ephemeral message errors", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";
  let ephemeralMessagesValue = new Uint8Array();
  let transitionCount = 0;

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) =>
          clientAPublicKey === signingPublicKey,
        getSnapshotKey: () => key,
        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        applyEphemeralMessage: (ephemeralMessage) => {
          ephemeralMessagesValue = new Uint8Array([
            ...ephemeralMessagesValue,
            ephemeralMessage,
          ]);
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    transitionCount = transitionCount + 1;
    // console.log("transitionCount", transitionCount);
    if (transitionCount === 27 && state.matches("connected.idle")) {
      expect(state.context._ephemeralMessageAuthoringErrors.length).toEqual(20);
      expect(state.context._ephemeralMessageAuthoringErrors[0].message).toEqual(
        `Wrong ephemeral message key #${23}`
      );
      expect(
        state.context._ephemeralMessageAuthoringErrors[19].message
      ).toEqual(`Wrong ephemeral message key #${4}`);
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  for (let step = 0; step < 25; step++) {
    syncService.send({
      type: "FAILED_CREATING_EPHEMERAL_UPDATE",
      error: new Error(`Wrong ephemeral message key #${step}`),
    });
  }
});

test("fails in case the collaborator is not valid", (done) => {
  const websocketServiceMock = (context: any) => () => {};

  let docValue = "";

  const syncMachine = createSyncMachine();
  const syncService = interpret(
    syncMachine
      .withContext({
        ...syncMachine.context,
        documentId: docId,
        websocketHost: url,
        websocketSessionKey: "sessionKey",
        isValidClient: (signingPublicKey) => false,
        getSnapshotKey: () => key,

        applySnapshot: (snapshot) => {
          docValue = sodium.to_string(snapshot);
        },
        deserializeChanges: (changes) => {
          return changes;
        },
        applyChanges: (changes) => {
          changes.forEach((change) => {
            docValue = docValue + change;
          });
        },
        sodium: sodium,
        signatureKeyPair: clientAKeyPair,
      })
      .withConfig({
        actions: {
          spawnWebsocketActor: assign((context) => {
            const ephemeralMessagesSession = createEphemeralSession(
              context.sodium
            );
            return {
              _ephemeralMessagesSession: ephemeralMessagesSession,
              _websocketActor: spawn(
                websocketServiceMock(context),
                "websocketActor"
              ),
            };
          }),
        },
      })
  ).onTransition((state) => {
    if (state.value === "failed") {
      expect(state.context._documentDecryptionState).toBe("failed");
      done();
    }
  });

  syncService.start();
  syncService.send({ type: "WEBSOCKET_RETRY" });
  syncService.send({ type: "WEBSOCKET_CONNECTED" });

  const { snapshot } = createSnapshotTestHelper();
  syncService.send({
    type: "WEBSOCKET_ADD_TO_INCOMING_QUEUE",
    data: {
      type: "document",
      snapshot,
    },
  });
});
