const express = require("express");

const app = express();
app.use(express.json());

// "base de datos" en memoria (TEMPORAL)
const users = {};

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

// CREAR CUENTA
app.post("/register", (req, res) => {
    const { username, password } = req.body;

    if (users[username]) {
        return res.status(400).json({ error: "User exists" });
    }

    users[username] = {
        password: password
    };

    res.json({ ok: true, message: "User created" });
});

// LOGIN
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    const user = users[username];

    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    if (user.password !== password) {
        return res.status(401).json({ error: "Wrong password" });
    }

    res.json({ ok: true, user: username });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse running on " + PORT);
});
