const {test}=require('node:test');const assert=require('node:assert/strict');
const {courseURLs,preferredPage,isLoginURL}=require('../desktop/browser.cjs');
test('恢复课程时不重复打开旧登录页，且过滤无关地址',()=>{
  const course='https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=demo';
  assert.deepEqual(courseURLs(['https://passport2.chaoxing.com/login',course,course]),[course]);
  assert.deepEqual(courseURLs(['file:///test','https://chaoxing.com.evil.test/','https://example.com/']),[]);
});
test('旧扫码入口使用 HTTPS 返回地址，保留指向具体课程的合法返回地址',()=>{
  const normalized=courseURLs(['https://passport2.chaoxing.com/login','https://passport2.chaoxing.com/login']);
  assert.equal(normalized.length,1);assert.equal(new URL(normalized[0]).searchParams.get('refer'),'https://i.chaoxing.com/');
  const course='https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=demo';
  const valid=new URL('https://passport2.chaoxing.com/login');valid.searchParams.set('refer',course);
  assert.equal(new URL(courseURLs([valid.href])[0]).searchParams.get('refer'),course);
});
test('重复点击打开浏览器时优先显示课程，避免已在学习却反复看到旧登录页',()=>{
  const login={url:()=> 'https://passport2.chaoxing.com/login'},course={url:()=> 'https://mooc1.chaoxing.com/mycourse/studentstudy'};
  assert.equal(preferredPage([login,course]),course);assert.equal(preferredPage([login]),login);
  assert.equal(isLoginURL(login.url()),true);assert.equal(isLoginURL(course.url()),false);
});
