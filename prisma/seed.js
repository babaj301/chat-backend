const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  // Create default rooms
  const defaultRooms = [
    { name: "General Chat" },
    { name: "Random Discussion" },
  ];

  for (const room of defaultRooms) {
    const existingRoom = await prisma.room.findFirst({
      where: { name: room.name },
    });

    if (!existingRoom) {
      await prisma.room.create({
        data: room,
      });
      console.log(`Created default room: ${room.name}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
