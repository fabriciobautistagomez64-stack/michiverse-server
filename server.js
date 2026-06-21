const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: "64kb" }));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://michiverse_cuentas_postgres_user:Bb0cHwkv1omhBFEV5kSfxNDgWGxPZgMe@dpg-d8s62isvikkc7399nc60-a/michiverse_cuentas_postgres",
    ssl: { rejectUnauthorized: false }
});

function now() {
    return Date.now();
}

function generateUniqueId() {
    return String(crypto.randomInt(100000000, 999999999));
}

function isOnline(user) {
    return typeof user.lastPing === "number" && (now() - user.lastPing) < 10000;
}

function rowToUser(row) {
    if (!row) {
        return null;
    }

    return {
        id: String(row.id || ""),
        username: String(row.username || "Guest"),
        passwordHash: String(row.password_hash || ""),
        coins: Number.isFinite(Number(row.coins)) ? Number(row.coins) : 0,
        inventory: Array.isArray(row.inventory) ? row.inventory : [],
        friends: Array.isArray(row.friends) ? row.friends.map(String) : [],
        lastPing: row.last_ping ? new Date(row.last_ping).getTime() : 0,
        isPlaying: !!row.is_playing
    };
}

function getPublicUser(user) {
    const normalized = rowToUser(user);

    if (!normalized) {
        return null;
    }

    return {
        id: normalized.id,
        username: normalized.username,
        coins: normalized.coins,
        inventory: normalized.inventory,
        friends: normalized.friends,
        isPlaying: normalized.isPlaying,
        online: isOnline(normalized)
    };
}

async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            coins INTEGER NOT NULL DEFAULT 0,
            inventory JSONB NOT NULL DEFAULT '[]'::jsonb,
            friends JSONB NOT NULL DEFAULT '[]'::jsonb,
            last_ping TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            is_playing BOOLEAN NOT NULL DEFAULT FALSE
        );
    `);
}

async function findUserByUsername(username) {
    return pool.query(
        `SELECT * FROM users WHERE lower(username) = lower($1) LIMIT 1`,
        [String(username || "").trim()]
    );
}

async function findUserById(id) {
    return pool.query(
        `SELECT * FROM users WHERE id = $1 LIMIT 1`,
        [String(id || "").trim()]
    );
}

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

app.get("/users", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM users ORDER BY username ASC`);
        const publicUsers = result.rows.map(getPublicUser).filter(Boolean);
        return res.json({ ok: true, users: publicUsers });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/users/:id", async (req, res) => {
    try {
        const result = await findUserById(req.params.id);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        return res.json({ ok: true, user: getPublicUser(result.rows[0]) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/username-exists/:username", async (req, res) => {
    try {
        const username = String(req.params.username || "").trim();

        if (!username) {
            return res.status(400).json({ error: "Falta username" });
        }

        const result = await findUserByUsername(username);

        return res.json({
            ok: true,
            exists: result.rows.length > 0
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/register", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        if (username.length < 3) {
            return res.status(400).json({ error: "Username muy corto" });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: "Contraseña muy corta" });
        }

        const exists = await findUserByUsername(username);
        if (exists.rows.length > 0) {
            return res.status(409).json({ error: "Ese nombre ya existe" });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        let inserted = null;

        for (let attempts = 0; attempts < 10; attempts++) {
            const id = generateUniqueId();

            try {
                const result = await pool.query(
                    `INSERT INTO users (id, username, password_hash, coins, inventory, friends, last_ping, is_playing)
                     VALUES ($1, $2, $3, 0, '[]'::jsonb, '[]'::jsonb, NOW(), FALSE)
                     RETURNING *`,
                    [id, username, passwordHash]
                );

                inserted = result.rows[0];
                break;
            } catch (err) {
                if (err && err.code === "23505") {
                    continue;
                }
                throw err;
            }
        }

        if (!inserted) {
            return res.status(500).json({ error: "No se pudo crear el usuario" });
        }

        log("User registered", `${username} (${inserted.id})`);

        return res.json({
            ok: true,
            user: getPublicUser(inserted)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const username = String(req.body.username || "").trim();
        const password = String(req.body.password || "");

        if (!username || !password) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        const result = await findUserByUsername(username);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = result.rows[0];
        const ok = await bcrypt.compare(password, user.password_hash);

        if (!ok) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        const updated = await pool.query(
            `UPDATE users
             SET last_ping = NOW()
             WHERE id = $1
             RETURNING *`,
            [user.id]
        );

        log("User logged", `${user.username} (${user.id})`);

        return res.json({
            ok: true,
            user: getPublicUser(updated.rows[0])
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/logout", async (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();

        if (!userId) {
            return res.status(400).json({ error: "Falta userId" });
        }

        const result = await findUserById(userId);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        await pool.query(
            `UPDATE users
             SET last_ping = to_timestamp(0), is_playing = FALSE
             WHERE id = $1`,
            [userId]
        );

        log("User logged out", `${result.rows[0].username} (${userId})`);

        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/ping", async (req, res) => {
    try {
        const userId = String(req.body.userId || "").trim();
        const isPlaying = !!req.body.isPlaying;

        if (!userId) {
            return res.status(400).json({ error: "Falta userId" });
        }

        const result = await findUserById(userId);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const updated = await pool.query(
            `UPDATE users
             SET last_ping = NOW(), is_playing = $2
             WHERE id = $1
             RETURNING *`,
            [userId, isPlaying]
        );

        return res.json({
            ok: true,
            online: true,
            isPlaying: updated.rows[0].is_playing
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.get("/presence/:id", async (req, res) => {
    try {
        const result = await findUserById(req.params.id);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = rowToUser(result.rows[0]);

        return res.json({
            ok: true,
            userId: user.id,
            username: user.username,
            online: isOnline(user),
            isPlaying: user.isPlaying,
            lastPing: user.lastPing
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

app.post("/friends/add", async (req, res) => {
    const client = await pool.connect();

    try {
        const userId = String(req.body.userId || "").trim();
        const friendId = String(req.body.friendId || "").trim();

        if (!userId || !friendId) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        if (userId === friendId) {
            return res.status(400).json({ error: "No te puedes agregar a ti mismo" });
        }

        await client.query("BEGIN");

        const userResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
        const friendResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [friendId]);

        if (userResult.rows.length === 0 || friendResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = rowToUser(userResult.rows[0]);
        const friend = rowToUser(friendResult.rows[0]);

        if (!user.friends.includes(friendId)) {
            user.friends.push(friendId);
        }

        if (!friend.friends.includes(userId)) {
            friend.friends.push(userId);
        }

        const updatedUser = await client.query(
            `UPDATE users SET friends = $1::jsonb WHERE id = $2 RETURNING *`,
            [JSON.stringify(user.friends), userId]
        );

        const updatedFriend = await client.query(
            `UPDATE users SET friends = $1::jsonb WHERE id = $2 RETURNING *`,
            [JSON.stringify(friend.friends), friendId]
        );

        await client.query("COMMIT");

        log("Friend added", `${user.username} <-> ${friend.username}`);

        return res.json({
            ok: true,
            user: getPublicUser(updatedUser.rows[0]),
            friend: getPublicUser(updatedFriend.rows[0])
        });
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {}
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    } finally {
        client.release();
    }
});

app.post("/friends/remove", async (req, res) => {
    const client = await pool.connect();

    try {
        const userId = String(req.body.userId || "").trim();
        const friendId = String(req.body.friendId || "").trim();

        if (!userId || !friendId) {
            return res.status(400).json({ error: "Faltan datos" });
        }

        await client.query("BEGIN");

        const userResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
        const friendResult = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [friendId]);

        if (userResult.rows.length === 0 || friendResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const user = rowToUser(userResult.rows[0]);
        const friend = rowToUser(friendResult.rows[0]);

        user.friends = user.friends.filter(id => id !== friendId);
        friend.friends = friend.friends.filter(id => id !== userId);

        const updatedUser = await client.query(
            `UPDATE users SET friends = $1::jsonb WHERE id = $2 RETURNING *`,
            [JSON.stringify(user.friends), userId]
        );

        const updatedFriend = await client.query(
            `UPDATE users SET friends = $1::jsonb WHERE id = $2 RETURNING *`,
            [JSON.stringify(friend.friends), friendId]
        );

        await client.query("COMMIT");

        log("Friend removed", `${user.username} <-> ${friend.username}`);

        return res.json({
            ok: true,
            user: getPublicUser(updatedUser.rows[0]),
            friend: getPublicUser(updatedFriend.rows[0])
        });
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch {}
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    } finally {
        client.release();
    }
});

app.get("/online", async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM users ORDER BY username ASC`);
        const onlineUsers = result.rows.map(rowToUser).filter(isOnline).map(getPublicUser).filter(Boolean);
        return res.json({ ok: true, users: onlineUsers });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Error del servidor" });
    }
});

function log(message, value = "") {
    if (value !== "") {
        console.log(`[Michiverse] ${message}: ${value}`);
    } else {
        console.log(`[Michiverse] ${message}`);
    }
}

async function start() {
    try {
        await initDb();

        app.listen(PORT, () => {
            log("Michiverse server running on " + PORT);
        });
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    try {
        await pool.end();
    } finally {
        process.exit(0);
    }
});

process.on("SIGTERM", async () => {
    try {
        await pool.end();
    } finally {
        process.exit(0);
    }
});

start();
