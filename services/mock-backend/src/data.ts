export interface Customer { id: string; name: string; phone: string; email: string; rrn: string; account: string; grade: 'standard' | 'gold' | 'vip'; status: 'active' | 'inactive' | 'suspended' }
export function seedCustomers(): Customer[] {
  const surnames = ['홍', '김', '이', '박', '최'], givenNames = ['길동', '민수', '서연', '지우', '도윤'];
  return Array.from({ length: 200 }, (_, index) => ({
    id: `C${String(index + 1).padStart(3, '0')}`,
    name: surnames[index % 5] + givenNames[Math.floor(index / 5) % 5],
    phone: `010-${String(1000 + index).padStart(4, '0')}-${String(5678 + index).padStart(4, '0')}`,
    email: `${index === 0 ? 'hong' : `customer${index + 1}`}@example.com`,
    rrn: `900101-${String(1000000 + index)}`,
    account: `1234-5678-${String(1234 + index)}`,
    grade: (['standard', 'gold', 'vip'] as const)[index % 3],
    status: index % 10 === 9 ? 'inactive' : 'active',
  }));
}
export function customerOrders(id: string) {
  const index = Number(id.slice(1));
  return Array.from({ length: 3 }, (_, order) => ({ id: `${id}-O${order + 1}`, customerId: id, total: 10000 + index * 100 + order * 5000, status: order === 2 ? 'pending' : 'completed', createdAt: `2026-08-${String(order + 1).padStart(2, '0')}T00:00:00.000Z` }));
}
