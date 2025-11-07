import { v4 as uuidv4 } from 'uuid';
import sha1 from 'sha1';
import redisClient from '../utils/redis.mjs';
import dbClient from '../utils/db.mjs';

class AuthController {
  static async getConnect(req, res) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      // Decode Base64
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const [email, password] = credentials.split(':');

      if (!email || !password) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Find user by email and password
      const db = await dbClient.getDb();
      const usersCollection = db.collection('users');
      const hashedPassword = sha1(password);
      const user = await usersCollection.findOne({ email, password: hashedPassword });

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Generate token
      const token = uuidv4();
      const key = `auth_${token}`;
      const userId = user._id.toString();

      // Store in Redis for 24 hours (86400 seconds)
      await redisClient.set(key, userId, 86400);

      return res.status(200).json({ token });
    } catch (error) {
      console.error('Error in getConnect:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  static async getDisconnect(req, res) {
    const token = req.headers['x-token'];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const key = `auth_${token}`;
      const userId = await redisClient.get(key);

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Delete token from Redis
      await redisClient.del(key);

      return res.status(204).send();
    } catch (error) {
      console.error('Error in getDisconnect:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
}

export default AuthController;

