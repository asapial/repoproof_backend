import dotenv from "dotenv";
import { parseEnvironment } from "./envValidation";

dotenv.config({ quiet: true });
export const envVars = parseEnvironment(process.env);
