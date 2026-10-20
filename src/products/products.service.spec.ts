import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Product } from './product.schema';
import { ProductsService } from './products.service';

describe('ProductsService ownership', () => {
  let service: ProductsService;
  const productId = new Types.ObjectId().toHexString();
  const owner = new Types.ObjectId().toHexString();
  const stranger = new Types.ObjectId().toHexString();
  const document = { _id: productId, ownerId: owner };
  const model = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };
  const operations = [
    'read',
    'original',
    'final',
    'processed',
    'description',
  ] as const;
  type Operation = (typeof operations)[number];
  function run(operation: Operation, id = productId, memberId = owner) {
    switch (operation) {
      case 'read':
        return service.requireOwnedProduct(id, memberId);
      case 'original':
        return service.updateOriginalImage(id, memberId, 'original');
      case 'final':
        return service.updateFinalEditedImage(id, memberId, 'final');
      case 'processed':
        return service.updateProcessedImages(id, memberId, 'original', 'final');
      case 'description':
        return service.updateDescription(id, memberId, 'en', 'description');
    }
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getModelToken(Product.name), useValue: model },
      ],
    }).compile();
    service = module.get(ProductsService);
  });
  beforeEach(() => {
    jest.clearAllMocks();
    const query = (filter: { _id: string; ownerId: string }) => ({
      exec: async () =>
        filter._id === productId && filter.ownerId === owner ? document : null,
    });
    model.findOne.mockImplementation(query);
    model.findOneAndUpdate.mockImplementation(query);
  });
  it.each(operations)(
    'allows owner access with an owner-scoped query: %s',
    async (operation) => {
      await expect(run(operation)).resolves.toBe(document);
      const method =
        operation === 'read' ? model.findOne : model.findOneAndUpdate;
      expect(method.mock.calls[0][0]).toEqual({
        _id: productId,
        ownerId: owner,
      });
    },
  );
  it.each(operations)(
    'hides missing and non-owned products identically: %s',
    async (operation) => {
      await expect(run(operation, productId, stranger)).rejects.toThrow(
        new NotFoundException('Product not found'),
      );
      await expect(
        run(operation, new Types.ObjectId().toHexString()),
      ).rejects.toThrow(new NotFoundException('Product not found'));
    },
  );
  it.each(operations)(
    'rejects invalid product IDs without querying: %s',
    async (operation) => {
      await expect(run(operation, 'invalid')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(model.findOne).not.toHaveBeenCalled();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it.each(operations)(
    'rejects invalid member IDs without querying: %s',
    async (operation) => {
      await expect(run(operation, productId, 'invalid')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(model.findOne).not.toHaveBeenCalled();
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid member IDs on creation and listing', async () => {
    await expect(service.create('test', 'invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.findByOwner('invalid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(model.find).not.toHaveBeenCalled();
  });
});
