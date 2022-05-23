const express = require('express');
const fs = require('fs');
var path = require('path');
const multer = require('multer');
const upload = multer({ destination: './downloads' });
const app = express();
const port = 3001;

app.post('/upload', upload.single('pdf'), (req, res) => {
  if (req.file.originalname.includes('pdf')) {
    if (!fs.existsSync('./downloads')) fs.mkdirSync('./downloads');

    fs.writeFileSync(`./downloads/${req.file.originalname}`, req.file.buffer);
    console.log(`./downloads/${req.file.originalname} created`);
    res.status(201).end();
  } else {
    res.status(500).end();
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
