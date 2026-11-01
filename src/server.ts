import app from "./app";
import { prisma } from "./lib/prisma";
import { envVars } from "./config/env";

const PORT = Number(envVars.PORT);

async function main() {
    try {
        await prisma.$connect();
        console.log("Connected to the database successfully.");

        const server = app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
        const shutdown = () => {
            const deadline = setTimeout(() => { server.closeAllConnections(); }, 5000);
            deadline.unref();
            server.close(() => { void prisma.$disconnect().finally(() => clearTimeout(deadline)); });
        };
        process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
    } catch {
        console.error(JSON.stringify({ event: "startup_failed" }));
        await prisma.$disconnect();
        process.exit(1);
    }
}

main();
