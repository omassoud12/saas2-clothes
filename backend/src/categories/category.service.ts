import { Prisma, type PrismaClient } from '../generated/prisma/client.js'
import { HttpError } from '../errors/http-error.js'
import type {
  CategoryDependencies,
  CategoryInput,
} from './category.types.js'

const categorySelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
} as const

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  )
}

function categoryNotFound(): HttpError {
  return new HttpError(404, 'CATEGORY_NOT_FOUND', 'Category does not exist')
}

function categoryAlreadyExists(): HttpError {
  return new HttpError(
    409,
    'CATEGORY_ALREADY_EXISTS',
    'A Category with this name already exists',
  )
}

async function createCategory(
  prisma: PrismaClient,
  accountId: string,
  input: CategoryInput,
) {
  try {
    return await prisma.category.create({
      data: { accountId, name: input.name },
      select: categorySelect,
    })
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw categoryAlreadyExists()
    throw error
  }
}

async function updateCategory(
  prisma: PrismaClient,
  accountId: string,
  categoryId: string,
  input: CategoryInput,
) {
  try {
    return await prisma.category.update({
      where: { id_accountId: { id: categoryId, accountId } },
      data: { name: input.name },
      select: categorySelect,
    })
  } catch (error) {
    if (isPrismaError(error, 'P2002')) throw categoryAlreadyExists()
    if (isPrismaError(error, 'P2025')) throw categoryNotFound()
    throw error
  }
}

async function deleteCategory(
  prisma: PrismaClient,
  accountId: string,
  categoryId: string,
): Promise<void> {
  try {
    await prisma.category.delete({
      where: { id_accountId: { id: categoryId, accountId } },
      select: { id: true },
    })
  } catch (error) {
    if (isPrismaError(error, 'P2025')) throw categoryNotFound()
    if (isPrismaError(error, 'P2003')) {
      throw new HttpError(
        409,
        'CATEGORY_IN_USE',
        'Category cannot be deleted while it is in use',
      )
    }
    throw error
  }
}

export function createCategoryDependencies(
  prisma: PrismaClient,
): CategoryDependencies {
  return {
    listCategories(accountId) {
      return prisma.category.findMany({
        where: { accountId },
        orderBy: { name: 'asc' },
        select: categorySelect,
      })
    },

    createCategory(accountId, input) {
      return createCategory(prisma, accountId, input)
    },

    updateCategory(accountId, categoryId, input) {
      return updateCategory(prisma, accountId, categoryId, input)
    },

    deleteCategory(accountId, categoryId) {
      return deleteCategory(prisma, accountId, categoryId)
    },
  }
}
