const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const cfg = require('../config');

const client = new S3Client({
  region: cfg.AWS_REGION,
  credentials: {
    accessKeyId: cfg.AWS_ACCESS_KEY_ID,
    secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY,
  },
});

async function uploadMealPhoto(userId, buffer, contentType = 'image/jpeg') {
  const date = new Date().toISOString().slice(0, 10);
  const id = crypto.randomBytes(8).toString('hex');
  const key = `meals/${userId}/${date}/${id}.jpg`;
  await client.send(new PutObjectCommand({
    Bucket: cfg.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

module.exports = { uploadMealPhoto };
