import express from "express";

const app = express();

app.get("/", (req, res) => {
    res.send("Michiverse server online");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Michiverse server running on port " + PORT);
});
