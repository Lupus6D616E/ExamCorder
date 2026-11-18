import Elysia, { t } from "elysia";
import { betterAuthPlugin } from "../../auth";
import { db } from "../../db/db";
import { exams, examLog } from "../../db/schema";
import { secureRandomString } from "../../lib/rand-string";
import { eq, and, desc } from "drizzle-orm";
export const hostPlugin = new Elysia({ prefix: "/host" })
    .use(betterAuthPlugin)
    .get("/exams/:id", async ({body, status}) =>{

    })
    .get("/exams", async ({ user, status }) => {
        const res = await db
            .select({
                title: exams.name,
                id: exams.id,
                code: exams.code,
                status: exams.status
            })
            .from(exams)
            .where(
                eq(exams.userId, user.id)
            )
            .orderBy(desc(exams.createdAt))
        return res
    }, {
        auth: true
    })
    .post("/exams", async ({ user, body, status }) => {
        let code = secureRandomString(6) + "-" + secureRandomString(6)
        let miracle = false
        do {
            const codeConflict = await db
                .select()
                .from(exams)
                .where(
                    eq(exams.code, code)
                )
            if (codeConflict.length > 0) {
                console.log("IT'S A GODDAMN MIRACLE!")
                code = secureRandomString(6) + "-" + secureRandomString(6)
                miracle = true
            } else {
                miracle = false
            }
        } while (miracle)
        const nameConflict = await db
            .select()
            .from(exams)
            .where(and(
                eq(exams.userId, user.id),
                eq(exams.name, body.name)
            ))
        if (nameConflict.length > 0) {
            console.log(nameConflict)
            return status(409, "Name Already Exists")
        }
        const res = await db.insert(exams)
            .values({
                name: body.name,
                userId: user.id,
                code: code
            }).returning()
        console.log(res)
        return {
            name: res[0].name,
            code: res[0].code,
            id: res[0].id,

        }
    }, {
        auth: true,
        body: t.Object({
            name: t.String({
                minLength: 1,
                maxLength: 100,
            })
        })
    })