import { v4 as uuidv4 } from 'uuid';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import mime from 'mime-types';
import dbClient from '../utils/db.mjs';
import redisClient from '../utils/redis.mjs';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const access = promisify(fs.access);

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

  static async getShow(req, res) {
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

      const { id } = req.params;
      if (!id) {
        return res.status(404).json({ error: 'Not found' });
      }

      let fileId;
      try {
        fileId = ObjectId(id);
      } catch (error) {
        return res.status(404).json({ error: 'Not found' });
      }

      const userIdObj = ObjectId(userId);
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');
      const file = await filesCollection.findOne({ _id: fileId, userId: userIdObj });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Format response
      const response = {
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: file.isPublic,
        parentId: file.parentId === '0' ? 0 : (file.parentId.toString ? file.parentId.toString() : file.parentId),
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error('Error in getShow:', error);
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async getIndex(req, res) {
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

      const parentId = req.query.parentId || '0';
      const page = parseInt(req.query.page, 10) || 0;
      const pageSize = 20;
      const skip = page * pageSize;

      const userIdObj = ObjectId(userId);
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');

      // Build query for parentId
      let parentIdQuery;
      if (parentId === '0') {
        parentIdQuery = '0';
      } else {
        try {
          parentIdQuery = ObjectId(parentId);
        } catch (error) {
          // Invalid ObjectId, return empty list
          return res.status(200).json([]);
        }
      }

      // Find files with pagination
      const files = await filesCollection
        .find({ userId: userIdObj, parentId: parentIdQuery })
        .skip(skip)
        .limit(pageSize)
        .toArray();

      // Format response
      const response = files.map((file) => ({
        id: file._id.toString(),
        userId: file.userId.toString(),
        name: file.name,
        type: file.type,
        isPublic: file.isPublic,
        parentId: file.parentId === '0' ? 0 : (file.parentId.toString ? file.parentId.toString() : file.parentId),
      }));

      return res.status(200).json(response);
    } catch (error) {
      console.error('Error in getIndex:', error);
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  static async putPublish(req, res) {
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

      const { id } = req.params;
      if (!id) {
        return res.status(404).json({ error: 'Not found' });
      }

      let fileId;
      try {
        fileId = ObjectId(id);
      } catch (error) {
        return res.status(404).json({ error: 'Not found' });
      }

      const userIdObj = ObjectId(userId);
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');

      // Check if file exists and belongs to user
      const file = await filesCollection.findOne({ _id: fileId, userId: userIdObj });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Update isPublic to true
      await filesCollection.updateOne(
        { _id: fileId, userId: userIdObj },
        { $set: { isPublic: true } }
      );

      // Get updated file
      const updatedFile = await filesCollection.findOne({ _id: fileId, userId: userIdObj });

      // Format response
      const response = {
        id: updatedFile._id.toString(),
        userId: updatedFile.userId.toString(),
        name: updatedFile.name,
        type: updatedFile.type,
        isPublic: updatedFile.isPublic,
        parentId: updatedFile.parentId === '0' ? 0 : (updatedFile.parentId.toString ? updatedFile.parentId.toString() : updatedFile.parentId),
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error('Error in putPublish:', error);
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async putUnpublish(req, res) {
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

      const { id } = req.params;
      if (!id) {
        return res.status(404).json({ error: 'Not found' });
      }

      let fileId;
      try {
        fileId = ObjectId(id);
      } catch (error) {
        return res.status(404).json({ error: 'Not found' });
      }

      const userIdObj = ObjectId(userId);
      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');

      // Check if file exists and belongs to user
      const file = await filesCollection.findOne({ _id: fileId, userId: userIdObj });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Update isPublic to false
      await filesCollection.updateOne(
        { _id: fileId, userId: userIdObj },
        { $set: { isPublic: false } }
      );

      // Get updated file
      const updatedFile = await filesCollection.findOne({ _id: fileId, userId: userIdObj });

      // Format response
      const response = {
        id: updatedFile._id.toString(),
        userId: updatedFile.userId.toString(),
        name: updatedFile.name,
        type: updatedFile.type,
        isPublic: updatedFile.isPublic,
        parentId: updatedFile.parentId === '0' ? 0 : (updatedFile.parentId.toString ? updatedFile.parentId.toString() : updatedFile.parentId),
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error('Error in putUnpublish:', error);
      return res.status(404).json({ error: 'Not found' });
    }
  }

  static async getFile(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(404).json({ error: 'Not found' });
      }

      let fileId;
      try {
        fileId = ObjectId(id);
      } catch (error) {
        return res.status(404).json({ error: 'Not found' });
      }

      const db = await dbClient.getDb();
      const filesCollection = db.collection('files');
      const file = await filesCollection.findOne({ _id: fileId });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Check if file is public or user is owner
      const token = req.headers['x-token'];
      let userId = null;
      if (token) {
        const key = `auth_${token}`;
        userId = await redisClient.get(key);
      }

      const isOwner = userId && file.userId.toString() === userId;
      const isPublic = file.isPublic === true;

      if (!isPublic && !isOwner) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Check if file type is folder
      if (file.type === 'folder') {
        return res.status(400).json({ error: "A folder doesn't have content" });
      }

      // Check if file has localPath
      if (!file.localPath) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Check if file exists locally
      try {
        await access(file.localPath, fs.constants.F_OK);
      } catch (error) {
        return res.status(404).json({ error: 'Not found' });
      }

      // Get MIME type from filename
      const mimeType = mime.lookup(file.name) || 'application/octet-stream';

      // Read and return file content
      const fileContent = await readFile(file.localPath);

      res.setHeader('Content-Type', mimeType);
      return res.status(200).send(fileContent);
    } catch (error) {
      console.error('Error in getFile:', error);
      return res.status(404).json({ error: 'Not found' });
    }
  }
}

export default FilesController;

