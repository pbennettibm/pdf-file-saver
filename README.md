# pdf-file-saver

```
npm install
```

## To use PDF Email Scraper

1. Copy config.json.sample to config.json.
2. Edit email user & password
3. Edit any additional fields necessary for specific email providers.
4. ```
   npm run start-email
   ```

## To use PDF File Uploader locally

1. ```
   npm start
   ```
2. In a separate terminal window run 
   ```
   curl -F pdf=@<filename.pdf> http://localhost:3001/upload
   ```
