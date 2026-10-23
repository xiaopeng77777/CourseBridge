param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [Parameter(Mandatory=$true)][string]$IconPath
)
$ErrorActionPreference='Stop'
$resolvedExe=(Resolve-Path -LiteralPath $ExePath).Path
$resolvedIcon=(Resolve-Path -LiteralPath $IconPath).Path
if([IO.Path]::GetExtension($resolvedExe) -ne '.exe'){throw '目标必须是 Windows 程序。'}
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CourseBridgeIconResources {
  delegate bool NameCallback(IntPtr module,IntPtr type,IntPtr name,IntPtr param);
  delegate bool LanguageCallback(IntPtr module,IntPtr type,IntPtr name,ushort language,IntPtr param);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryExW(string file,IntPtr reserved,uint flags);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceNamesW(IntPtr module,IntPtr type,NameCallback callback,IntPtr param);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool EnumResourceLanguagesW(IntPtr module,IntPtr type,IntPtr name,LanguageCallback callback,IntPtr param);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResourceW(string file,bool deleteExisting);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool UpdateResourceW(IntPtr handle,IntPtr type,IntPtr name,ushort language,byte[] data,uint length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool EndUpdateResourceW(IntPtr handle,bool discard);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr FindResourceExW(IntPtr module,IntPtr type,IntPtr name,ushort language);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint SizeofResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr LoadResource(IntPtr module,IntPtr resource);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr LockResource(IntPtr resource);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern void SHChangeNotify(uint action,uint flags,string path,IntPtr unused);
  static IntPtr Id(int value){return new IntPtr(value);}
  static void Check(bool success){if(!success)throw new Win32Exception(Marshal.GetLastWin32Error());}
  static IntPtr Open(string file){var module=LoadLibraryExW(file,IntPtr.Zero,2);if(module==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());return module;}
  static List<ushort> Names(IntPtr module,int type){var ids=new List<ushort>();NameCallback callback=(m,t,n,p)=>{long id=n.ToInt64();if(id>0&&id<=65535)ids.Add((ushort)id);return true;};EnumResourceNamesW(module,Id(type),callback,IntPtr.Zero);GC.KeepAlive(callback);return ids;}
  static List<ushort> Languages(IntPtr module,int type,int name){var values=new List<ushort>();LanguageCallback callback=(m,t,n,l,p)=>{values.Add(l);return true;};Check(EnumResourceLanguagesW(module,Id(type),Id(name),callback,IntPtr.Zero));GC.KeepAlive(callback);return values;}
  static byte[] Read(IntPtr module,int type,int name,ushort language){var resource=FindResourceExW(module,Id(type),Id(name),language);if(resource==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());var size=SizeofResource(module,resource);var bytes=new byte[size];Marshal.Copy(LockResource(LoadResource(module,resource)),bytes,0,(int)size);return bytes;}
  static List<byte[]> Frames(byte[] ico){if(ico.Length<6||BitConverter.ToUInt16(ico,0)!=0||BitConverter.ToUInt16(ico,2)!=1)throw new InvalidDataException("无效 ICO 文件");int count=BitConverter.ToUInt16(ico,4);if(count<1||count>32||ico.Length<6+count*16)throw new InvalidDataException("ICO 帧数不正确");var frames=new List<byte[]>();for(int i=0;i<count;i++){int entry=6+i*16;uint length=BitConverter.ToUInt32(ico,entry+8),offset=BitConverter.ToUInt32(ico,entry+12);if(offset<6+count*16||(long)offset+length>ico.Length)throw new InvalidDataException("ICO 帧越界");byte[] image=new byte[length];Buffer.BlockCopy(ico,(int)offset,image,0,(int)length);frames.Add(image);}return frames;}
  public static string Apply(string executable,string icon){
    byte[] ico=File.ReadAllBytes(icon);var images=Frames(ico);var targets=new List<Tuple<ushort,ushort>>();var module=Open(executable);int start=1000;
    try{foreach(var group in Names(module,14))foreach(var language in Languages(module,14,group))targets.Add(Tuple.Create(group,language));var imageIds=Names(module,3);if(imageIds.Count>0)start=Math.Max(start,imageIds.Max()+1);}finally{FreeLibrary(module);}
    if(targets.Count<1||targets.Count>64||start+images.Count>65535)throw new InvalidDataException("不支持的程序图标资源布局");
    byte[] directory=new byte[6+images.Count*14];Buffer.BlockCopy(ico,0,directory,0,6);
    for(int i=0;i<images.Count;i++){Buffer.BlockCopy(ico,6+i*16,directory,6+i*14,12);Buffer.BlockCopy(BitConverter.GetBytes((ushort)(start+i)),0,directory,6+i*14+12,2);}
    var handle=BeginUpdateResourceW(executable,false);if(handle==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());bool committed=false;
    try{foreach(var target in targets){for(int i=0;i<images.Count;i++)Check(UpdateResourceW(handle,Id(3),Id(start+i),target.Item2,images[i],(uint)images[i].Length));Check(UpdateResourceW(handle,Id(14),Id(target.Item1),target.Item2,directory,(uint)directory.Length));}Check(EndUpdateResourceW(handle,false));committed=true;}finally{if(!committed)EndUpdateResourceW(handle,true);}
    module=Open(executable);
    try{foreach(var target in targets){if(!Read(module,14,target.Item1,target.Item2).SequenceEqual(directory))throw new InvalidDataException("图标目录校验失败");for(int i=0;i<images.Count;i++)if(!Read(module,3,start+i,target.Item2).SequenceEqual(images[i]))throw new InvalidDataException("图标帧校验失败");}}finally{FreeLibrary(module);}
    SHChangeNotify(0x2000,0x0005,executable,IntPtr.Zero);
    return "图标资源已替换并逐帧校验："+targets.Count+" 组，"+images.Count+" 个尺寸。";
  }
}
'@
for($attempt=0;$attempt -lt 3;$attempt++){
  try { [CourseBridgeIconResources]::Apply($resolvedExe,$resolvedIcon); break }
  catch { if($attempt -eq 2){throw}; Start-Sleep -Milliseconds 600 }
}
