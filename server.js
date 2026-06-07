require('dotenv').config();
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));

const SETUP_REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/auth/callback';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// Use the couple's stored refresh token to get a short-lived access token
async function getAccessToken() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GOOGLE_REFRESH_TOKEN not set. Visit /setup/auth to authorize the app.');
  }
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  return data.access_token;
}

// One-time setup: couple visits this URL to authorize the app
app.get('/setup/auth', (req, res) => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', SETUP_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  res.redirect(url.toString());
});

// One-time setup: Google redirects here after the couple signs in
app.get('/auth/callback', async (req, res) => {
  console.log('OAuth callback query:', req.query);
  if (req.query.error) return res.send(`Google returned an error: ${req.query.error}`);
  const { code } = req.query;
  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: SETUP_REDIRECT_URI,
      grant_type: 'authorization_code'
    });
    res.send(`
      <h2>Setup complete!</h2>
      <p>Add this line to your <code>.env</code> file, then restart the server:</p>
      <pre style="background:#f4f4f4;padding:12px;border-radius:6px">GOOGLE_REFRESH_TOKEN=${data.refresh_token}</pre>
    `);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.send('Setup failed. Check the server console for details.');
  }
});

// One-time setup: create the wedding Drive folder and return its ID
app.get('/setup/create-folder', async (req, res) => {
  try {
    const accessToken = await getAccessToken();
    const { data } = await axios.post(
      'https://www.googleapis.com/drive/v3/files',
      {
        name: 'Akshat & Mengyuan Wedding 💍',
        mimeType: 'application/vnd.google-apps.folder'
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    res.json({ folderId: data.id, folderName: data.name });
  } catch (err) {
    res.json({ error: err.response?.data || err.message });
  }
});

// Guests hit this to open the camera — no sign-in required
app.get('/camera', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'camera.html'));
});

// Receive a photo from a guest and upload it to the wedding Drive folder
app.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    const accessToken = await getAccessToken();

    const boundary = 'wedding_upload_boundary';
    const metadata = JSON.stringify({
      name: `wedding_${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID]
    });

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
      req.file.buffer,
      Buffer.from(`\r\n--${boundary}--`)
    ]);

    await axios.post(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      body,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`Wedding camera running at http://localhost:${process.env.PORT || 3000}`)
);
