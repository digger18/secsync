import { Update } from "secsync";
import { Prisma } from "../../prisma/generated/output";
import { serializeUpdate } from "../utils/serialize";
import { prisma } from "./prisma";

type CreateUpdateParams = {
  update: Update;
};

export async function createUpdate({ update }: CreateUpdateParams) {
  return await prisma.$transaction(async (prisma) => {
    const snapshot = await prisma.snapshot.findUniqueOrThrow({
      where: { id: update.publicData.refSnapshotId },
      select: {
        latestVersion: true,
        clocks: true,
        document: { select: { activeSnapshotId: true } },
      },
    });
    if (
      snapshot.document.activeSnapshotId !== update.publicData.refSnapshotId
    ) {
      throw new Error("Update referencing an out of date snapshot.");
    }

    if (
      snapshot.clocks &&
      typeof snapshot.clocks === "object" &&
      !Array.isArray(snapshot.clocks)
    ) {
      if (snapshot.clocks[update.publicData.pubKey] === undefined) {
        if (update.publicData.clock !== 0) {
          throw new Error("Update clock incorrect."); // TODO return additional data with the error?
        }
        // update the clock for the public key
        snapshot.clocks[update.publicData.pubKey] = update.publicData.clock;
      } else {
        if (
          // @ts-expect-error
          snapshot.clocks[update.publicData.pubKey] + 1 !==
          update.publicData.clock
        ) {
          throw new Error("Update clock incorrect."); // TODO return additional data with the error?
        }
        // update the clock for the public key
        snapshot.clocks[update.publicData.pubKey] = update.publicData.clock;
      }
    }

    await prisma.snapshot.update({
      where: { id: update.publicData.refSnapshotId },
      data: {
        latestVersion: snapshot.latestVersion + 1,
        clocks: snapshot.clocks as Prisma.JsonObject,
      },
    });

    return serializeUpdate(
      await prisma.update.create({
        data: {
          data: JSON.stringify(update),
          version: snapshot.latestVersion + 1,
          snapshot: {
            connect: {
              id: update.publicData.refSnapshotId,
            },
          },
          snapshotVersion: update.publicData.clock,
          pubKey: update.publicData.pubKey,
        },
      })
    );
  });
}
