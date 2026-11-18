import Elysia, { t } from "elysia";
import { betterAuthPlugin } from "../../auth";
import { db } from "../../db/db";
import { exams, examLog } from "../../db/schema";
import { secureRandomString } from "../../lib/rand-string";
import { eq, and, desc } from "drizzle-orm";

function recordingSegment(value: string) {
    return value
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase()
        .slice(0, 60) || "untitled";
}

export const hostPlugin = new Elysia({ prefix: "/host" })
    .use(betterAuthPlugin)
    .get("/exams/:code", async ({ params }) => {
        const [exam] = await db
            .select({ status: exams.status, expired: exams.expired })
            .from(exams)
            .where(eq(exams.code, params.code))
            .limit(1)

        return exam?.expired ? "expired" : exam?.status ?? "not found"
    })
    .get("/exams/logs/:id", async ({ params, user, status }) => {
        const examId = Number(params.id)
        if (!Number.isSafeInteger(examId)) return status(401, "Unauthorized")

        const [exam] = await db
            .select({ code: exams.code })
            .from(exams)
            .where(and(
                eq(exams.id, examId),
                eq(exams.userId, user.id),
            ))
            .limit(1)

        if (!exam) return status(401, "Unauthorized")

        return await db
            .select()
            .from(examLog)
            .where(eq(examLog.code, exam.code))
            .orderBy(desc(examLog.createdAt))
    },{
        auth: true
    })
    .get("/exams/logs/:id/videos", async ({ params, user, status }) => {
        const logId = Number(params.id)
        if (!Number.isSafeInteger(logId) || logId <= 0) return status(401, "Unauthorized")

        const [log] = await db
            .select({ id: examLog.id, name: examLog.name, code: examLog.code, expired: examLog.expired })
            .from(examLog)
            .where(eq(examLog.id, logId))
            .limit(1)
        if (!log) return status(401, "Unauthorized")

        const [ownedExam] = await db
            .select({ code: exams.code })
            .from(exams)
            .where(and(
                eq(exams.code, log.code),
                eq(exams.userId, user.id),
            ))
            .limit(1)
        if (!ownedExam) return status(401, "Unauthorized")
        if (log.expired) return status(410, "Recording expired")

        const dir = `./recordings/${recordingSegment(log.code)}/${recordingSegment(log.name)}`
        const metaFile = Bun.file(`${dir}/log-${log.id}_meta.json`)
        if (!await metaFile.exists()) return status(404, "Recording files not found")

        let timestamp: string
        try {
            const metadata = await metaFile.json() as { timestamp?: unknown }
            if (typeof metadata.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}$/.test(metadata.timestamp)) {
                return status(404, "Recording files not found")
            }
            timestamp = metadata.timestamp
        } catch {
            return status(404, "Recording files not found")
        }

        const displayFile = Bun.file(`${dir}/display_${timestamp}.webm`)
        const webcamFile = Bun.file(`${dir}/webcam_${timestamp}.webm`)
        if (!await displayFile.exists() || !await webcamFile.exists()) {
            return status(404, "Recording files not found")
        }

        const boundary = `examcorder-${crypto.randomUUID()}`
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                for (const [partName, filename, file] of [
                    ["display", `display_${timestamp}.webm`, displayFile],
                    ["webcam", `webcam_${timestamp}.webm`, webcamFile],
                ] as const) {
                    controller.enqueue(encoder.encode(
                        `--${boundary}\r\nContent-Type: video/webm\r\nContent-Disposition: form-data; name="${partName}"; filename="${filename}"\r\n\r\n`,
                    ))
                    const reader = file.stream().getReader()
                    try {
                        while (true) {
                            const { done, value } = await reader.read()
                            if (done) break
                            controller.enqueue(value)
                        }
                    } finally {
                        reader.releaseLock()
                    }
                    controller.enqueue(encoder.encode("\r\n"))
                }
                controller.enqueue(encoder.encode(`--${boundary}--\r\n`))
                controller.close()
            },
        })

        return new Response(body, {
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Disposition": `attachment; filename="exam-log-${log.id}.multipart"`,
                "X-Content-Type-Options": "nosniff",
            },
        })
    }, {
        auth: true
    })
    .get("/exams", async ({ user, status }) => {
        const res = await db
            .select({
                title: exams.name,
                id: exams.id,
                code: exams.code,
                status: exams.status,
                expired: exams.expired,
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
    .patch("/exams/status/:id", async ({ params, user, body, status }) => {
        const examId = Number(params.id)
        if (!Number.isSafeInteger(examId) || examId <= 0) return status(401, "Unauthorized")

        const [ownedExam] = await db
            .select({ expired: exams.expired })
            .from(exams)
            .where(and(
                eq(exams.id, examId),
                eq(exams.userId, user.id),
            ))
            .limit(1)
        if (!ownedExam) return status(401, "Unauthorized")
        if (ownedExam.expired) return status(410, "Exam expired")

        const [updatedExam] = await db
            .update(exams)
            .set({ status: body.status })
            .where(and(
                eq(exams.id, examId),
                eq(exams.userId, user.id),
                eq(exams.expired, false),
            ))
            .returning({ id: exams.id, status: exams.status })

        if (!updatedExam) return status(401, "Unauthorized")
        return updatedExam
    }, {
        auth: true,
        body: t.Object({
            status: t.Union([t.Literal("enabled"), t.Literal("disabled")]),
        }),
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
