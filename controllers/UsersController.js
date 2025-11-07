import sha1 from 'sha1';
import { ObjectId } from 'mongodb';
import dbClient from '../utils/db.mjs';
import redisClient from '../utils/redis.mjs';

class UsersController {
  static async postNew(req, res) {
    const { email, password } = req.body;

    // Check if email is missing
    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }

    // Check if password is missing
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    try {
      const db = await dbClient.getDb();
      const usersCollection = db.collection('users');

      // Check if email already exists
      const existingUser = await usersCollection.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: 'Already exist' });
      }

      // Hash the password
      const hashedPassword = sha1(password);

      // Create new user
      const result = await usersCollection.insertOne({
        email,
        password: hashedPassword,
      });

      // Return the new user with only email and id
      return res.status(201).json({
        id: result.insertedId.toString(),
        email,
      });
    } catch (error) {
      console.error('Error creating user:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getMe(req, res) {
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

      // Find user by ID
      const db = await dbClient.getDb();
      const usersCollection = db.collection('users');
      const userObj = await usersCollection.findOne({ _id: ObjectId(userId) });

      if (!userObj) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      return res.status(200).json({
        id: userObj._id.toString(),
        email: userObj.email,
      });
    } catch (error) {
      console.error('Error in getMe:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
}

export default UsersController;

