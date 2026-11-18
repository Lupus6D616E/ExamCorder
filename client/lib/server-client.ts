import type {ExamcorderServer} from "../../server/src/index"
import { treaty } from "@elysia/eden"
import { tokenItem } from "./auth-client"
const apiUrl = import.meta.env.WXT_API_URL!
export const server = treaty<ExamcorderServer>(apiUrl, {
  headers: async () => {
    const token = await tokenItem.getValue();
    return token ? { Authorization: `Bearer ${token}` } : undefined;
  },
})
 