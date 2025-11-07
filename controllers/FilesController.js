import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import dbClient from '../utils/db.mjs';
import redisClient from '../utils/redis.mjs';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

class FilesController {
  static async postUpload(req, res) {
    // Get user from token
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

      const { name, type, parentId = '0', isPublic = false, data } = req.body;

      // Validate name
      if (!name) {
        return res.status(400).json({ error: 'Missing name' });
      }

      // Validate type
      if (!type || !['folder', 'file', 'image'].includes(type)) {
        return res.status(400).json({ error: 'Missing type' });
      }

      // Validate data for non-folder types
      if (type !== 'folder' && !data) {
        return res.status(400).json({ error: 'Missing data' });
      }

      // Validate parentId if set
      let parentIdObj = null;
      if (parentId !== '0') {
        try {
          parentIdObj = ObjectId(parentId);
        } catch (error) {
          return res.status(400).json({ error: 'Parent not found' });
        }

        const db = await dbClient.getDb();
        const filesCollection = db.collection('files');
        const parentFile = await filesCollection.findOne({ _id: parentIdObj });

        if (!parentFile) {
          return res.status(400).json({ error: 'Parent not found' });
        }

        if (parentFile.type !== 'folder') {
          return res.status(400).json({ error: 'Parent is not a folder' });
        }
      }

      const userIdObj = ObjectId(userId);
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');

      // Handle folder type
      if (type === 'folder') {
        const dbParentId = parentId === '0' ? '0' : parentIdObj;
        const result = await filesCollection.insertOne({
          userId: userIdObj,
          name,
          type,
          parentId: dbParentId,
          isPublic,
        });

        const responseParentId = parentId === '0' ? 0 : parentId;
        return res.status(201).json({
          id: result.insertedId.toString(),
          userId: userId,
          name,
          type,
          isPublic,
          parentId: responseParentId,
        });
      }

      // Handle file/image types
      // Get folder path from environment or use default
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';

      // Create folder if it doesn't exist
      try {
        await mkdir(folderPath, { recursive: true });
      } catch (error) {
        // Folder might already exist, ignore error
      }

      // Generate UUID filename
      const filename = uuidv4();
      const localPath = path.join(folderPath, filename);
      const absolutePath = path.resolve(localPath);

      // Decode Base64 and write file
      const fileBuffer = Buffer.from(data, 'base64');
      await writeFile(absolutePath, fileBuffer);

      // Save to database
      const dbParentId = parentId === '0' ? '0' : parentIdObj;
      const result = await filesCollection.insertOne({
        userId: userIdObj,
        name,
        type,
        isPublic,
        parentId: dbParentId,
        localPath: absolutePath,
      });

      const responseParentId = parentId === '0' ? 0 : parentId;
      return res.status(201).json({
        id: result.insertedId.toString(),
        userId: userId,
        name,
        type,
        isPublic,
        parentId: responseParentId,
      });
    } catch (error) {
      console.error('Error in postUpload:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
}

export default FilesController;

