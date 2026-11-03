// Entirely SYNTHETIC products, packaging evidence and copy. No real product
// composition, benefit, manufacturer or country is asserted by these fixtures.
export const cosmeticsProducts = [
  {
    category: 'serum',
    language: 'en',
    name: 'Example Night Serum',
    source: `Product name: Example Night Serum
Brand: Example Night
Ingredients: Retinol 0.2%, Squalane
Manufacturer: Example Lab SAS
Distributor: Example Trading, Seoul, Korea
Volume: 28 mL
Made in France
Benefits: Moisturizes skin.
Directions: Apply as directed on this label.`,
    percentages: ['0.2%'],
    origin: 'France',
  },
  {
    category: 'cream',
    language: 'uz',
    name: 'Namuna Parvarish Kremi',
    source: `Mahsulot nomi: Namuna Parvarish Kremi
Brend: Namuna
Tarkibi: Panthenol 2%, Glycerin 5%, Aqua
Ishlab chiqaruvchi: Namuna Laboratoriyasi
Import qiluvchi: Misol Import
Hajmi: 45 g
Ishlab chiqarilgan mamlakat: O‘zbekiston`,
    percentages: ['2%', '5%'],
    origin: 'O‘zbekiston',
  },
  {
    category: 'cleanser',
    language: 'ru',
    name: 'Пример очищающего геля',
    source: `Название продукта: Пример очищающего геля
Бренд: Пример
Состав: Salicylic Acid 0.5%, Coco Glucoside 4%, Aqua
Производитель: Beispiel Labor GmbH
Дистрибьютор: Пример торговли, Москва, Россия
Объём: 150 мл
Страна производства: Germany`,
    percentages: ['0.5%', '4%'],
    origin: 'Germany',
  },
  {
    category: 'toner',
    language: 'ko',
    name: '예시 수분 토너',
    source: `제품명: 예시 수분 토너
브랜드: 예시
전성분: Aqua, Sodium Hyaluronate 0.1%, Glycerin
제조업자: 예시 서울 연구소
화장품책임판매업자: 예시 판매 회사
용량: 200 mL`,
    percentages: ['0.1%'],
    origin: undefined,
  },
  {
    category: 'sunscreen',
    language: 'en',
    name: 'Example SPF 50 PA+++ Sunscreen',
    source: `Product name: Example SPF 50 PA+++ Sunscreen
Brand: Example Sun
Ingredients: Zinc Oxide 15%, Aqua
Manufacturer: Example Solar SL
Importer: Example Imports, Tokyo, Japan
Volume: 50 mL
Made in Spain`,
    percentages: ['15%'],
    origin: 'Spain',
  },
  {
    category: 'mask',
    language: 'ru',
    name: 'Пример маски',
    source: `Название продукта: Пример маски
Состав: Kaolin 20%, Aloe Barbadensis Leaf Juice 3%
Импортёр: Example France SARL, Paris, France
Объём: 25 г`,
    percentages: ['20%', '3%'],
    origin: undefined,
  },
  {
    category: 'oil',
    language: 'uz',
    name: 'Namuna Parvarish Moy',
    source: `Mahsulot nomi: Namuna Parvarish Moy
Tarkibi: Squalane 80%, Prunus Amygdalus Dulcis Oil 20%
Distribyutor: Misol Savdo, Seoul, Korea
Hajmi: 35 mL
Made in Italy`,
    percentages: ['80%', '20%'],
    origin: 'Italy',
  },
  {
    category: 'incomplete label',
    language: 'ko',
    name: '예시 여행용 제품',
    source: `제품명: 예시 여행용 제품
회사명: Example Korea Inc.
주소: Seoul, Korea
모델: 10 4 50
전성분:`,
    percentages: [],
    origin: undefined,
  },
] as const;
