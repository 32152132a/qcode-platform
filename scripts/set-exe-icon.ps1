param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class QCodeIcon {
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr BeginUpdateResource(string path,bool delete);
 [DllImport("kernel32",SetLastError=true)] static extern bool UpdateResource(IntPtr h,IntPtr type,IntPtr name,ushort lang,byte[] bytes,uint size);
 [DllImport("kernel32",SetLastError=true)] static extern bool EndUpdateResource(IntPtr h,bool discard);
 [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string path,IntPtr reserved,uint flags);
 delegate bool Callback(IntPtr h,IntPtr type,IntPtr name,IntPtr param);
 [DllImport("kernel32",CharSet=CharSet.Unicode)] static extern bool EnumResourceNames(IntPtr h,IntPtr type,Callback callback,IntPtr param);
 [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr h);
 public static void Apply(string path,string icon) {
  byte[] b=File.ReadAllBytes(icon);
  if(b.Length<6 || BitConverter.ToUInt16(b,2)!=1) throw new InvalidDataException("Invalid ICO");
  ushort count=BitConverter.ToUInt16(b,4);
  if(count==0 || b.Length<6+16*count) throw new InvalidDataException("Truncated ICO");
  var names=new System.Collections.Generic.List<int>();
  IntPtr module=LoadLibraryEx(path,IntPtr.Zero,2);
  if(module==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"LoadLibraryEx failed");
  try { EnumResourceNames(module,(IntPtr)14,(h,t,n,p)=>{if(n.ToInt64()>65535) return false; names.Add(n.ToInt32());return true;},IntPtr.Zero); } finally {FreeLibrary(module);}
  if(names.Count==0) names.Add(1);
  IntPtr handle=BeginUpdateResource(path,false);
  if(handle==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(),"BeginUpdateResource failed");
  bool done=false;
  try {
   using(var stream=new MemoryStream()) using(var writer=new BinaryWriter(stream)) {
    writer.Write((ushort)0);writer.Write((ushort)1);writer.Write(count);
    for(int i=0;i<count;i++) {
     int entry=6+16*i;uint size=BitConverter.ToUInt32(b,entry+8),offset=BitConverter.ToUInt32(b,entry+12);
     if((ulong)offset+size>(ulong)b.Length) throw new InvalidDataException("Truncated frame");
     byte[] frame=new byte[size];Array.Copy(b,(long)offset,frame,0,(long)size);
     if(!UpdateResource(handle,(IntPtr)3,(IntPtr)(1000+i),1033,frame,size)) throw new Win32Exception();
     writer.Write(b,entry,12);writer.Write((ushort)(1000+i));
    }
    byte[] group=stream.ToArray();
    foreach(int name in names) if(!UpdateResource(handle,(IntPtr)14,(IntPtr)name,1033,group,(uint)group.Length)) throw new Win32Exception();
   }
   done=true;
  } finally {if(!EndUpdateResource(handle,!done)) throw new Win32Exception(Marshal.GetLastWin32Error(),"EndUpdateResource failed");}
 }
}
'@
$exePath=(Resolve-Path -LiteralPath $Executable).Path
$iconPath=(Resolve-Path -LiteralPath $Icon).Path
# IExpress/Windows scanning may briefly keep the new file locked after process exit.
for($attempt=1;$attempt -le 3;$attempt++){
    try{[QCodeIcon]::Apply($exePath,$iconPath);break}catch{
        if($attempt -eq 3){throw}
        Start-Sleep -Milliseconds 1000
    }
}
