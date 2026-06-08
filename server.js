const express = require("express");

const app = express();
app.use(express.json());

const users = {};

app.post("/register", (req, res) => {
    const { username, password } = req.body;

    if (users[username]) {
        return res.status(400).json({ error: "User exists" });
    }

    users[username] = {
        password: password
    };

    res.json({ ok: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!users[username]) {
        return res.status(404).json({ error: "No user" });
    }

    if (users[username].password !== password) {
        return res.status(401).json({ error: "Wrong password" });
    }

    res.json({ ok: true, user: username });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse auth running on " + PORT);
});
